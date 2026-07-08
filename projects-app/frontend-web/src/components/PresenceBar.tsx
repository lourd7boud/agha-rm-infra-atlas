import { useState, useEffect, useRef, useCallback } from 'react';
import { Wifi, ChevronDown } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { getRealtimeSocket } from '../services/realtimeSync';
import { apiService } from '../services/apiService';
import { useAuthStore } from '../store/authStore';
import { useLocation } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface OnlineUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  currentPage?: string;
  currentActivity?: string;
  projectName?: string;
  lastHeartbeat: string;
}

// Map page routes to friendly names
const PAGE_LABELS: Record<string, string> = {
  '/': 'Tableau de bord',
  '/projects': 'Projets',
  '/admin': 'Admin',
  '/admin/users': 'Gestion utilisateurs',
  '/reports': 'Rapports',
  '/settings': 'Paramètres',
};

function getPageLabel(path: string): string {
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  if (path.includes('/projet/') || path.includes('/project/')) return 'Projet';
  if (path.includes('/decompt')) return 'Décompte';
  if (path.includes('/bordereau')) return 'Bordereau';
  if (path.includes('/metre')) return 'Métré';
  return 'Navigation';
}

// ═══════════════════════════════════════════════════════════════
// Presence Socket Manager — standalone connection for Web users
// ═══════════════════════════════════════════════════════════════

let presenceSocket: Socket | null = null;

function getOrCreatePresenceSocket(): Socket | null {
  // First try the realtimeSync socket (works for Electron)
  const rtSocket = getRealtimeSocket();
  if (rtSocket?.connected) return rtSocket;

  // For Web: create a dedicated presence socket if not yet created
  if (presenceSocket?.connected) return presenceSocket;

  const token = localStorage.getItem('authToken');
  if (!token) return null;

  // Determine socket URL
  let socketUrl: string;
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    socketUrl = window.location.origin;
  } else {
    socketUrl = 'http://localhost:5000';
  }

  console.log('🟢 [Presence] Creating dedicated presence socket:', socketUrl);

  presenceSocket = io(socketUrl, {
    path: `${(import.meta as any).env?.BASE_URL || '/'}socket.io/`,
    auth: { token, deviceId: 'web-presence' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
    forceNew: false,
  });

  presenceSocket.on('connect', () => {
    console.log('🟢 [Presence] Socket connected:', presenceSocket?.id);
  });

  presenceSocket.on('connect_error', (err) => {
    console.warn('🔴 [Presence] Socket connect error:', err.message);
  });

  presenceSocket.on('disconnect', (reason) => {
    console.log('🟡 [Presence] Socket disconnected:', reason);
  });

  return presenceSocket;
}

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (presenceSocket) {
      presenceSocket.disconnect();
      presenceSocket = null;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// PresenceBar Component
// ═══════════════════════════════════════════════════════════════

export default function PresenceBar() {
  const { user: currentUser } = useAuthStore();
  const location = useLocation();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Initialize socket connection
  useEffect(() => {
    if (!currentUser) return;

    // Small delay to let auth settle
    const timer = setTimeout(() => {
      socketRef.current = getOrCreatePresenceSocket();
    }, 1000);

    return () => clearTimeout(timer);
  }, [currentUser]);

  // Send heartbeat with current page info
  const sendHeartbeat = useCallback(() => {
    const socket = socketRef.current || getOrCreatePresenceSocket();
    if (!socket?.connected) return;

    socket.emit('presence:heartbeat', {
      page: location.pathname,
      activity: getPageLabel(location.pathname),
    });
  }, [location.pathname]);

  // Initial load + periodic refresh of online users
  useEffect(() => {
    const loadOnline = async () => {
      try {
        const result = await apiService.getOnlineUsers();
        setOnlineUsers((result.data || []).filter((u: OnlineUser) => u.id !== currentUser?.id));
      } catch {
        // Silently fail - presence is non-critical
      }
    };

    loadOnline();
    const refreshInterval = setInterval(loadOnline, 15000);
    return () => clearInterval(refreshInterval);
  }, [currentUser?.id]);

  // Listen for socket presence updates
  useEffect(() => {
    if (!currentUser) return;

    // Wait for socket to be ready
    const checkSocket = () => {
      const socket = socketRef.current || getOrCreatePresenceSocket();
      if (!socket) return;

      socketRef.current = socket;

      const handlePresenceUpdate = () => {
        apiService.getOnlineUsers().then(result => {
          setOnlineUsers((result.data || []).filter((u: OnlineUser) => u.id !== currentUser?.id));
        }).catch(() => {});
      };

      socket.on('presence:update', handlePresenceUpdate);
      return () => { socket.off('presence:update', handlePresenceUpdate); };
    };

    // Retry a few times in case socket isn't ready yet
    const timer = setTimeout(checkSocket, 2000);
    return () => clearTimeout(timer);
  }, [currentUser?.id]);

  // Heartbeat on location change + periodic
  useEffect(() => {
    sendHeartbeat();

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(sendHeartbeat, 30000);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [sendHeartbeat]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (onlineUsers.length === 0) return null;

  // Show max 3 avatars
  const visibleUsers = onlineUsers.slice(0, 3);
  const extraCount = Math.max(0, onlineUsers.length - 3);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Avatar Stack */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
        title={`${onlineUsers.length} utilisateur(s) en ligne`}
      >
        <div className="flex -space-x-2">
          {visibleUsers.map(user => (
            <div
              key={user.id}
              className="w-7 h-7 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 border-2 border-slate-800 flex items-center justify-center text-white text-[10px] font-bold"
              title={`${user.firstName} ${user.lastName}`}
            >
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
          ))}
          {extraCount > 0 && (
            <div className="w-7 h-7 rounded-full bg-slate-600 border-2 border-slate-800 flex items-center justify-center text-white text-[10px] font-bold">
              +{extraCount}
            </div>
          )}
        </div>
        <span className="text-xs text-slate-300 font-medium ml-1">
          {onlineUsers.length} en ligne
        </span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold text-gray-900">Utilisateurs en ligne</span>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {onlineUsers.length}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
            {onlineUsers.map(user => (
              <div key={user.id} className="px-4 py-2.5 hover:bg-gray-50">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-bold">
                      {user.firstName?.[0]}{user.lastName?.[0]}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {user.firstName} {user.lastName}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {user.currentActivity || user.currentPage || 'En ligne'}
                      {user.projectName && (
                        <span className="text-blue-600"> · {user.projectName}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
