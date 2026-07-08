import { FC, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { User, Key, AlertTriangle } from 'lucide-react';

// Import login styles
import '../styles/login.css';

// App version from package or env
const APP_VERSION = '1.0.0';

// Professional construction/business images from Unsplash
const BANNER_IMAGE = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&h=300&fit=crop&q=80';
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920&h=1080&fit=crop&q=80';

const LoginPage: FC = () => {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(formData.email, formData.password);
      navigate('/');
    } catch (error) {
      // Error handled by store
    }
  };

  return (
    <div className="login-wrapper" style={{ backgroundImage: `url(${BACKGROUND_IMAGE})` }}>
      {/* Background Overlay */}
      <div className="login-overlay" />
      
      {/* Login Card */}
      <div className="login-card">
        {/* Header with Logo */}
        <div className="login-header">
          <div className="login-logo">
            {/* Professional Logo SVG - Chart with Arrow and Circle */}
            <svg viewBox="0 0 120 90" className="login-logo-svg">
              {/* Chart bars - Blue and Orange */}
              <rect x="8" y="55" width="18" height="30" fill="#1e66d0" rx="2" />
              <rect x="32" y="40" width="18" height="45" fill="#f7941d" rx="2" />
              <rect x="56" y="25" width="18" height="60" fill="#1e66d0" rx="2" />
              
              {/* Curved Arrow - Orange */}
              <path 
                d="M 5 65 Q 30 15, 85 8" 
                stroke="#f7941d" 
                strokeWidth="5" 
                fill="none" 
                strokeLinecap="round"
              />
              {/* Arrow head */}
              <polygon points="82,2 92,10 80,14" fill="#f7941d" />
              
              {/* Circle around last bar - Orange */}
              <circle cx="90" cy="60" r="22" fill="none" stroke="#f7941d" strokeWidth="4" />
            </svg>
          </div>
          <div className="login-title-group">
            <h1 className="login-title">Application</h1>
            <h2 className="login-subtitle">de Gestion de Projet</h2>
          </div>
        </div>

        {/* Professional Banner - Matching the design */}
        <div className="login-banner">
          <img 
            src={BANNER_IMAGE} 
            alt="Modern City Buildings" 
            className="login-banner-image"
          />
          <div className="login-banner-overlay">
            {/* Full Banner SVG with businessmen, chart and gears */}
            <svg viewBox="0 0 560 160" className="login-banner-people" preserveAspectRatio="xMidYMid slice">
              {/* World map background - subtle */}
              <defs>
                <linearGradient id="skyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{stopColor: '#e8f4fc', stopOpacity: 0.9}} />
                  <stop offset="50%" style={{stopColor: '#d4e9f7', stopOpacity: 0.85}} />
                  <stop offset="100%" style={{stopColor: '#c5dff0', stopOpacity: 0.8}} />
                </linearGradient>
              </defs>
              
              {/* Background rect */}
              <rect width="560" height="160" fill="url(#skyGrad)" />
              
              {/* World map dots - subtle pattern */}
              <g opacity="0.15" fill="#1e66d0">
                <circle cx="80" cy="50" r="2" />
                <circle cx="120" cy="45" r="1.5" />
                <circle cx="160" cy="55" r="2" />
                <circle cx="200" cy="40" r="1.5" />
                <circle cx="240" cy="60" r="2" />
                <circle cx="280" cy="35" r="1.5" />
                <circle cx="320" cy="50" r="2" />
                <circle cx="360" cy="45" r="1.5" />
                <circle cx="400" cy="55" r="2" />
              </g>
              
              {/* Two businessmen silhouettes - left side */}
              <g transform="translate(80, 45)">
                {/* Person 1 - darker */}
                <ellipse cx="0" cy="95" rx="15" ry="5" fill="rgba(30, 50, 80, 0.3)" />
                <circle cx="0" cy="15" r="12" fill="rgba(30, 50, 80, 0.85)" />
                <path d="M -12 30 L -15 95 L 15 95 L 12 30 Q 0 25, -12 30" fill="rgba(30, 50, 80, 0.85)" />
                
                {/* Person 2 - slightly lighter, taller */}
                <ellipse cx="35" cy="95" rx="16" ry="5" fill="rgba(45, 70, 100, 0.3)" />
                <circle cx="35" cy="10" r="14" fill="rgba(45, 70, 100, 0.9)" />
                <path d="M 20 28 L 17 95 L 53 95 L 50 28 Q 35 22, 20 28" fill="rgba(45, 70, 100, 0.9)" />
              </g>
              
              {/* Chart bars - center-right */}
              <g transform="translate(220, 40)">
                <rect x="0" y="70" width="28" height="50" fill="#c5d9e8" rx="3" />
                <rect x="38" y="50" width="28" height="70" fill="#b8d4e8" rx="3" />
                <rect x="76" y="30" width="28" height="90" fill="#aacde5" rx="3" />
                <rect x="114" y="45" width="28" height="75" fill="#9cc6e2" rx="3" />
              </g>
              
              {/* Growing chart with arrow - right side */}
              <g transform="translate(380, 30)">
                {/* Chart bars growing */}
                <rect x="0" y="85" width="22" height="35" fill="#1e66d0" rx="2" />
                <rect x="28" y="65" width="22" height="55" fill="#f7941d" rx="2" />
                <rect x="56" y="45" width="22" height="75" fill="#1e66d0" rx="2" />
                <rect x="84" y="25" width="22" height="95" fill="#2d7dd2" rx="2" />
                
                {/* Arrow going up */}
                <path d="M 5 90 Q 50 30, 115 10" stroke="#f7941d" strokeWidth="4" fill="none" strokeLinecap="round" />
                <polygon points="112,5 122,15 110,18" fill="#f7941d" />
              </g>
              
              {/* Gears - top right corner */}
              <g transform="translate(490, 15)" opacity="0.5">
                <circle cx="30" cy="30" r="20" fill="none" stroke="#8b9eb3" strokeWidth="6" />
                <circle cx="30" cy="30" r="8" fill="#8b9eb3" />
                {/* Gear teeth */}
                <rect x="26" y="5" width="8" height="10" fill="#8b9eb3" />
                <rect x="26" y="45" width="8" height="10" fill="#8b9eb3" />
                <rect x="5" y="26" width="10" height="8" fill="#8b9eb3" />
                <rect x="45" y="26" width="10" height="8" fill="#8b9eb3" />
                
                {/* Smaller gear */}
                <circle cx="60" cy="55" r="14" fill="none" stroke="#a0b0c0" strokeWidth="4" />
                <circle cx="60" cy="55" r="5" fill="#a0b0c0" />
              </g>
            </svg>
          </div>
        </div>

        {/* Divider Line */}
        <div className="login-divider" />

        {/* Auth Section */}
        <div className="login-auth-section">
          <h3 className="login-auth-title">Authentification</h3>

          {/* Error Message */}
          {error && (
            <div className="login-error">
              <AlertTriangle className="login-error-icon" />
              <span>Nom d'utilisateur ou mot de passe incorrect</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="login-form">
            {/* Username Input */}
            <div className="login-input-wrapper">
              <div className="login-input-icon">
                <User className="w-5 h-5" />
              </div>
              <input
                id="email"
                type="email"
                required
                placeholder="Nom d'utilisateur"
                className="login-input"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            {/* Password Input */}
            <div className="login-input-wrapper">
              <div className="login-input-icon login-input-icon-key">
                <Key className="w-5 h-5" />
              </div>
              <input
                id="password"
                type="password"
                required
                placeholder="Mot de passe"
                className="login-input"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            {/* Submit Button */}
            <div className="login-button-wrapper">
              <button
                type="submit"
                disabled={isLoading}
                className="login-btn"
              >
                {isLoading ? 'Connexion...' : 'Connexion'}
              </button>
            </div>
          </form>
        </div>

        {/* Footer Links */}
        <div className="login-footer">
          <div className="login-footer-links">
            <Link to="/forgot-password" className="login-footer-link">
              Mot de passe oublié ?
            </Link>
          </div>
          
          <div className="login-footer-copyright">
            <span className="login-footer-dot" />
            <span>{new Date().getFullYear()} Tous droits réservés</span>
            <span className="login-footer-separator">Version : {APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
