import { FC, useState, useEffect, useRef } from 'react';
import { User, Search, X } from 'lucide-react';
import { searchIntervenants, Intervenant } from '../services/intervenantService';

interface IntervenantAutocompleteProps {
  type: 'assistanceTechnique' | 'maitreOeuvre';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  helpText?: string;
  className?: string;
}

const IntervenantAutocomplete: FC<IntervenantAutocompleteProps> = ({
  type,
  value,
  onChange,
  placeholder = 'Entrez un nom...',
  label,
  helpText,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Intervenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fermer les suggestions quand on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Rechercher les suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      setLoading(true);
      try {
        const results = await searchIntervenants(type, value);
        setSuggestions(results);
      } catch (error) {
        console.error('Erreur recherche intervenants:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(debounce);
  }, [type, value]);

  // Gérer la navigation clavier
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleSelect = (intervenant: Intervenant) => {
    onChange(intervenant.nom);
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}
      
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <User className="h-5 w-5 text-gray-400" />
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="input pl-10 pr-10"
          autoComplete="off"
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {helpText && (
        <p className="text-xs text-gray-500 mt-1">{helpText}</p>
      )}

      {/* Dropdown des suggestions */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="px-4 py-3 text-gray-500 text-sm">
              <Search className="inline-block w-4 h-4 mr-2 animate-spin" />
              Recherche...
            </div>
          ) : (
            <ul className="py-1">
              {suggestions.map((intervenant, index) => (
                <li
                  key={intervenant.id}
                  onClick={() => handleSelect(intervenant)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                    index === selectedIndex
                      ? 'bg-primary-50 text-primary-700'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">{intervenant.nom}</span>
                  </div>
                  {intervenant.usageCount > 1 && (
                    <span className="text-xs text-gray-400">
                      {intervenant.usageCount} projets
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Message si aucune suggestion */}
      {isOpen && !loading && suggestions.length === 0 && value && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="px-4 py-3 text-gray-500 text-sm">
            Aucun intervenant trouvé. Le nom sera ajouté automatiquement.
          </div>
        </div>
      )}
    </div>
  );
};

export default IntervenantAutocomplete;
