import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Plus, Lock, Unlock, Trash2, ArrowLeft, Search,
  Edit3, X, RefreshCw, CheckCircle, AlertCircle,
  Mail, Phone, Briefcase, Building2, Loader2, UserCheck, UserX
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiService } from '../services/apiService';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  trialEndDate?: string;
  createdBy?: string;
  createdAt: string;
  lastLogin?: string;
  jobTitle?: string;
  phone?: string;
  avatarUrl?: string;
  department?: string;
  projectCount: number;
  isOnline: boolean;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  super_admin: { label: 'Super Admin', color: 'text-purple-700', bg: 'bg-purple-100' },
  admin: { label: 'Administrateur', color: 'text-blue-700', bg: 'bg-blue-100' },
  user: { label: 'Utilisateur', color: 'text-gray-700', bg: 'bg-gray-100' },
};

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function UsersManagementPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiService.getAdminUsers();
      setUsers(result.data || []);
    } catch (err: any) {
      console.error('Error loading users:', err);
      setError(err.response?.data?.error?.message || err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.role !== 'super_admin' && currentUser?.role !== 'admin') {
      navigate('/');
      return;
    }
    loadUsers();
  }, [currentUser, navigate, loadUsers]);

  // Filtered users
  const filteredUsers = users.filter(u => {
    const matchSearch = !search ||
      `${u.firstName} ${u.lastName} ${u.email} ${u.jobTitle || ''} ${u.department || ''}`
        .toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === 'all' || u.role === filterRole;
    const matchStatus = filterStatus === 'all' ||
      (filterStatus === 'active' && u.isActive) ||
      (filterStatus === 'inactive' && !u.isActive) ||
      (filterStatus === 'online' && u.isOnline);
    return matchSearch && matchRole && matchStatus;
  });

  const handleToggleStatus = async (user: AdminUser) => {
    try {
      setActionLoading(user.id);
      await apiService.updateAdminUser(user.id, { isActive: !user.isActive });
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Erreur lors de la modification');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!confirm(`Supprimer ${user.firstName} ${user.lastName} ?\n\nCette action est irréversible.`)) return;
    try {
      setActionLoading(user.id);
      await apiService.deleteAdminUser(user.id);
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Erreur lors de la suppression');
    } finally {
      setActionLoading(null);
    }
  };

  // Stats
  const totalOnline = users.filter(u => u.isOnline).length;
  const totalActive = users.filter(u => u.isActive).length;

  if (loading && users.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Chargement des utilisateurs...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Header ─── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate('/admin')} className="p-2 hover:bg-gray-100 rounded-lg">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Users className="w-6 h-6" /></div>
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">Gestion des Utilisateurs</h1>
                  <p className="text-sm text-gray-500">
                    {users.length} utilisateurs · {totalActive} actifs · <span className="text-green-600">{totalOnline} en ligne</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={loadUsers} className="p-2 hover:bg-gray-100 rounded-lg" title="Rafraîchir">
                <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setShowCreateModal(true)} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Nouvel Utilisateur
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Filters ─── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par nom, email, poste..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="all">Tous les rôles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Administrateur</option>
            <option value="user">Utilisateur</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="inactive">Désactivés</option>
            <option value="online">En ligne</option>
          </select>
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={loadUsers} className="ml-auto text-red-600 hover:text-red-800 underline text-xs">Réessayer</button>
          </div>
        )}
      </div>

      {/* ─── Users Table ─── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utilisateur</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rôle</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Projets</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dernière Connexion</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {search || filterRole !== 'all' || filterStatus !== 'all'
                        ? 'Aucun utilisateur ne correspond aux filtres'
                        : 'Aucun utilisateur'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => (
                    <UserRow
                      key={user.id}
                      user={user}
                      currentUserId={currentUser?.id || ''}
                      currentUserRole={currentUser?.role || ''}
                      actionLoading={actionLoading}
                      onToggleStatus={() => handleToggleStatus(user)}
                      onDelete={() => handleDeleteUser(user)}
                      onEdit={() => setEditingUser(user)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); loadUsers(); }}
          isSuperAdmin={currentUser?.role === 'super_admin'}
        />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); loadUsers(); }}
          isSuperAdmin={currentUser?.role === 'super_admin'}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// User Row
// ═══════════════════════════════════════════════════════════════

function UserRow({ user, currentUserId, currentUserRole, actionLoading, onToggleStatus, onDelete, onEdit }: {
  user: AdminUser;
  currentUserId: string;
  currentUserRole: string;
  actionLoading: string | null;
  onToggleStatus: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const role = ROLE_CONFIG[user.role] || ROLE_CONFIG.user;
  const isSelf = user.id === currentUserId;
  const isLoading = actionLoading === user.id;
  const canModify = !isSelf && (currentUserRole === 'super_admin' || (currentUserRole === 'admin' && user.role === 'user'));

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${!user.isActive ? 'opacity-60' : ''}`}>
      {/* User Info */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-sm">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${user.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
              {user.firstName} {user.lastName}
              {isSelf && <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-normal">Vous</span>}
            </div>
            <div className="text-xs text-gray-500">{user.email}</div>
            {user.jobTitle && <div className="text-xs text-gray-400">{user.jobTitle}</div>}
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full ${role.bg} ${role.color}`}>
          {role.label}
        </span>
      </td>

      {/* Contact */}
      <td className="px-6 py-4">
        <div className="space-y-0.5">
          {user.phone && (
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Phone className="w-3 h-3" />{user.phone}
            </div>
          )}
          {user.department && (
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Building2 className="w-3 h-3" />{user.department}
            </div>
          )}
          {!user.phone && !user.department && <span className="text-xs text-gray-300">-</span>}
        </div>
      </td>

      {/* Status */}
      <td className="px-6 py-4">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
            user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {user.isActive ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
            {user.isActive ? 'Actif' : 'Désactivé'}
          </span>
          {user.isOnline && (
            <span className="text-[10px] text-green-600 font-medium">● En ligne</span>
          )}
        </div>
      </td>

      {/* Projects */}
      <td className="px-6 py-4">
        <span className="text-sm text-gray-600">{user.projectCount}</span>
      </td>

      {/* Last Login */}
      <td className="px-6 py-4">
        <span className="text-xs text-gray-500">{formatDate(user.lastLogin)}</span>
      </td>

      {/* Actions */}
      <td className="px-6 py-4">
        <div className="flex items-center justify-end gap-1">
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          ) : (
            <>
              <button onClick={onEdit} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg" title="Modifier">
                <Edit3 className="w-4 h-4" />
              </button>
              {canModify && (
                <>
                  <button
                    onClick={onToggleStatus}
                    className={`p-1.5 rounded-lg ${user.isActive ? 'hover:bg-orange-50 text-orange-600' : 'hover:bg-green-50 text-green-600'}`}
                    title={user.isActive ? 'Désactiver' : 'Activer'}
                  >
                    {user.isActive ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </button>
                  {currentUserRole === 'super_admin' && (
                    <button onClick={onDelete} className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════
// Create User Modal
// ═══════════════════════════════════════════════════════════════

function CreateUserModal({ onClose, onCreated, isSuperAdmin }: {
  onClose: () => void;
  onCreated: () => void;
  isSuperAdmin: boolean;
}) {
  const [form, setForm] = useState({
    email: '', password: '', firstName: '', lastName: '',
    role: 'user', jobTitle: '', phone: '', department: '',
    hasTrial: false, trialDays: 30,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setForm(f => ({ ...f, password: pw }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères'); return; }

    try {
      setSaving(true);
      const trialEndDate = form.hasTrial
        ? new Date(Date.now() + form.trialDays * 86400000).toISOString()
        : undefined;

      await apiService.createAdminUser({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        trialEndDate,
        jobTitle: form.jobTitle || undefined,
        phone: form.phone || undefined,
        department: form.department || undefined,
      });

      alert(`✅ Utilisateur créé avec succès!\n\n📧 Email: ${form.email}\n🔑 Mot de passe: ${form.password}\n\nCommuniquez ces informations de manière sécurisée.`);
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || 'Erreur de création');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-600" />
            Nouvel Utilisateur
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prénom *</label>
              <input type="text" required value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input type="text" required value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="input w-full" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input w-full pl-10" placeholder="email@domaine.ma" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe *</label>
            <div className="flex gap-2">
              <input type="text" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input flex-1" placeholder="Minimum 8 caractères" />
              <button type="button" onClick={generatePassword} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium whitespace-nowrap">
                Générer
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rôle *</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input w-full">
              <option value="user">Utilisateur</option>
              {isSuperAdmin && <option value="admin">Administrateur</option>}
              {isSuperAdmin && <option value="super_admin">Super Admin</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poste</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="input w-full pl-10" placeholder="Ingénieur, Métreur..." />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Département</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="input w-full pl-10" placeholder="Travaux, Bureau d'études..." />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input w-full pl-10" placeholder="+212 6XX XXX XXX" />
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
            <input type="checkbox" checked={form.hasTrial} onChange={e => setForm(f => ({ ...f, hasTrial: e.target.checked }))} className="w-4 h-4 text-blue-600 rounded" />
            <label className="text-sm font-medium text-gray-700 flex-1">Période d'essai</label>
            {form.hasTrial && (
              <div className="flex items-center gap-2">
                <input type="number" value={form.trialDays} onChange={e => setForm(f => ({ ...f, trialDays: parseInt(e.target.value) || 30 }))} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm" min={1} />
                <span className="text-sm text-gray-500">jours</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">Annuler</button>
            <button type="submit" disabled={saving} className="flex-1 btn btn-primary flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Edit User Modal
// ═══════════════════════════════════════════════════════════════

function EditUserModal({ user, onClose, onSaved, isSuperAdmin }: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
  isSuperAdmin: boolean;
}) {
  const [form, setForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    role: user.role,
    jobTitle: user.jobTitle || '',
    phone: user.phone || '',
    department: user.department || '',
    password: '',
    isActive: user.isActive,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password && form.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    try {
      setSaving(true);
      const data: Record<string, any> = {
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        isActive: form.isActive,
        jobTitle: form.jobTitle,
        phone: form.phone,
        department: form.department,
      };
      if (form.password) data.password = form.password;
      await apiService.updateAdminUser(user.id, data);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || 'Erreur de modification');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-blue-600" />
            Modifier: {user.firstName} {user.lastName}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
              <input type="text" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
              <input type="text" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="input w-full" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input w-full" disabled={!isSuperAdmin && (user.role === 'admin' || user.role === 'super_admin')}>
              <option value="user">Utilisateur</option>
              {isSuperAdmin && <option value="admin">Administrateur</option>}
              {isSuperAdmin && <option value="super_admin">Super Admin</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poste</label>
              <input type="text" value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Département</label>
              <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="input w-full" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
            <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input w-full" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nouveau mot de passe <span className="text-gray-400 font-normal">(laisser vide = inchangé)</span></label>
            <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input w-full" placeholder="Nouveau mot de passe..." />
          </div>

          <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 text-blue-600 rounded" />
            <label className="text-sm font-medium text-gray-700">Compte actif</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">Annuler</button>
            <button type="submit" disabled={saving} className="flex-1 btn btn-primary flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
