import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Settings, 
  Folder, 
  Cloud, 
  HardDrive, 
  Check, 
  ChevronRight,
  FolderOpen,
  Save,
  Info,
  RefreshCw,
} from 'lucide-react';
import {
  getStorageConfig,
  saveStorageConfig,
  selectBaseFolder,
  StorageConfig,
} from '../services/fileSystemService';

type StorageType = 'local' | 'onedrive' | 'google-drive' | 'custom';

interface StorageOption {
  type: StorageType;
  name: string;
  description: string;
  icon: FC<{ className?: string }>;
  available: boolean;
  comingSoon?: boolean;
}

const SettingsPage: FC = () => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<StorageConfig>(getStorageConfig());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    localStorage.getItem('base_folder_name')
  );
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<'storage' | 'general' | 'about'>('storage');

  const storageOptions: StorageOption[] = [
    {
      type: 'local',
      name: 'Stockage Local',
      description: 'Enregistrez vos projets sur votre ordinateur',
      icon: HardDrive,
      available: true,
    },
    {
      type: 'onedrive',
      name: 'OneDrive',
      description: 'Synchronisez avec Microsoft OneDrive',
      icon: Cloud,
      available: false,
      comingSoon: true,
    },
    {
      type: 'google-drive',
      name: 'Google Drive',
      description: 'Synchronisez avec Google Drive',
      icon: Cloud,
      available: false,
      comingSoon: true,
    },
  ];

  const handleSelectFolder = async () => {
    const folderName = await selectBaseFolder();
    if (folderName) {
      setSelectedFolder(folderName);
      setConfig(prev => ({ ...prev, basePath: folderName, customPath: folderName }));
    }
  };

  const handleSaveConfig = () => {
    saveStorageConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleStorageTypeChange = (type: StorageType) => {
    const option = storageOptions.find(o => o.type === type);
    if (option?.available) {
      setConfig(prev => ({ ...prev, type }));
    }
  };

  // Check if running in Electron
  const isElectron = !!(window as any).electronAPI?.isElectron || !!(window as any).electron?.isElectron;
  
  // Vérifier si le File System Access API est disponible (or Electron)
  const isFileSystemAccessSupported = isElectron || 'showDirectoryPicker' in window;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary-600" />
          {t('settings.title')}
        </h1>
        <p className="text-gray-600 mt-2">
          Configurez les paramètres de l'application
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <nav className="space-y-1">
            <button
              onClick={() => setActiveSection('storage')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                activeSection === 'storage'
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Folder className="w-5 h-5" />
              Stockage des fichiers
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
            <button
              onClick={() => setActiveSection('general')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                activeSection === 'general'
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Settings className="w-5 h-5" />
              Paramètres généraux
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
            <button
              onClick={() => setActiveSection('about')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                activeSection === 'about'
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Info className="w-5 h-5" />
              À propos
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {/* Storage Settings */}
          {activeSection === 'storage' && (
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <Folder className="w-6 h-6 text-primary-600" />
                Configuration du stockage
              </h2>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-blue-800 font-medium">Comment ça fonctionne ?</p>
                    <p className="text-blue-700 text-sm mt-1">
                      Choisissez un emplacement où tous vos dossiers de projets seront créés automatiquement.
                      Chaque projet aura sa propre structure de dossiers organisée (Bordereau, Métré, Décomptes, etc.).
                    </p>
                  </div>
                </div>
              </div>

              {/* Storage Type Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Type de stockage
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {storageOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.type}
                        onClick={() => handleStorageTypeChange(option.type)}
                        disabled={!option.available}
                        className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                          config.type === option.type
                            ? 'border-primary-500 bg-primary-50'
                            : option.available
                            ? 'border-gray-200 hover:border-gray-300'
                            : 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                        }`}
                      >
                        {option.comingSoon && (
                          <span className="absolute top-2 right-2 px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                            Bientôt
                          </span>
                        )}
                        <Icon className={`w-8 h-8 mb-2 ${
                          config.type === option.type ? 'text-primary-600' : 'text-gray-400'
                        }`} />
                        <p className={`font-medium ${
                          config.type === option.type ? 'text-primary-900' : 'text-gray-900'
                        }`}>
                          {option.name}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {option.description}
                        </p>
                        {config.type === option.type && (
                          <div className="absolute top-2 left-2">
                            <Check className="w-5 h-5 text-primary-600" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Local Storage Options */}
              {config.type === 'local' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dossier de base
                    </label>
                    
                    {isFileSystemAccessSupported ? (
                      <div className="flex gap-3">
                        <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
                          <FolderOpen className="w-5 h-5 text-gray-400" />
                          <span className={selectedFolder ? 'text-gray-900' : 'text-gray-500'}>
                            {selectedFolder || 'Aucun dossier sélectionné'}
                          </span>
                        </div>
                        <button
                          onClick={handleSelectFolder}
                          className="btn-primary flex items-center gap-2"
                        >
                          <Folder className="w-4 h-4" />
                          Choisir un dossier
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-yellow-800 text-sm">
                          <strong>Note :</strong> Votre navigateur ne supporte pas la sélection de dossiers.
                          Les fichiers seront téléchargés dans votre dossier de téléchargements par défaut.
                          <br />
                          <span className="text-yellow-700">
                            Pour une meilleure expérience, utilisez Chrome, Edge ou Opera.
                          </span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Folder Structure Preview */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Structure des dossiers
                    </label>
                    <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-sm">
                      <div className="text-yellow-400">📁 {selectedFolder || 'MesProjetsBTP'}/</div>
                      <div className="ml-4">
                        <div className="text-blue-400">📁 2025/</div>
                        <div className="ml-4">
                          <div className="text-green-400">📁 12-2025-dpa-ta/</div>
                          <div className="ml-4 text-gray-400">
                            <div>📁 Bordereau/</div>
                            <div>📁 Métré/</div>
                            <div>📁 Décomptes/</div>
                            <div>📁 Attachements/</div>
                            <div>📁 Photos/</div>
                            <div>📁 PV/</div>
                            <div>📁 Documents/</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="mt-6 pt-6 border-t flex justify-end">
                <button
                  onClick={handleSaveConfig}
                  className="btn-primary flex items-center gap-2"
                >
                  {saved ? (
                    <>
                      <Check className="w-4 h-4" />
                      Enregistré !
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Enregistrer les paramètres
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* General Settings */}
          {activeSection === 'general' && (
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">
                Paramètres généraux
              </h2>

              {/* Language */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Langue de l'interface
                </label>
                <div className="flex gap-2">
                  {[
                    { code: 'fr', label: 'Français', flag: '🇫🇷' },
                    { code: 'ar', label: 'العربية', flag: '🇲🇦' },
                    { code: 'en', label: 'English', flag: '🇬🇧' },
                  ].map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => i18n.changeLanguage(lang.code)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
                        i18n.language === lang.code
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-xl">{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-save */}
              <div className="mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    defaultChecked
                  />
                  <div>
                    <span className="font-medium text-gray-900">Sauvegarde automatique</span>
                    <p className="text-sm text-gray-500">
                      Enregistrer automatiquement les modifications
                    </p>
                  </div>
                </label>
              </div>

              {/* Data Management */}
              <div className="pt-6 border-t">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Gestion des données
                </h3>
                <div className="space-y-3">
                  <button className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                    <RefreshCw className="w-5 h-5 text-gray-400" />
                    <div>
                      <span className="font-medium text-gray-900">Exporter toutes les données</span>
                      <p className="text-sm text-gray-500">
                        Télécharger une sauvegarde complète
                      </p>
                    </div>
                  </button>
                  <button className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                    <Folder className="w-5 h-5 text-gray-400" />
                    <div>
                      <span className="font-medium text-gray-900">Importer des données</span>
                      <p className="text-sm text-gray-500">
                        Restaurer depuis une sauvegarde
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* About */}
          {activeSection === 'about' && (
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">
                À propos
              </h2>
              
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen className="w-10 h-10 text-primary-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">Suivi Chantier BTP</h3>
                <p className="text-gray-500 mt-1">Version 1.0.0</p>
                
                <div className="mt-6 text-sm text-gray-600">
                  <p>Application de gestion de projets BTP</p>
                  <p className="mt-2">
                    Développé pour simplifier la gestion des marchés,
                    <br />
                    des métrés, des décomptes et des attachements.
                  </p>
                </div>

                <div className="mt-8 pt-6 border-t text-sm text-gray-500">
                  <p>© 2025 - Tous droits réservés</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
