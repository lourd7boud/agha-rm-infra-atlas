import { FC, useState, useEffect, useRef } from 'react';
import { Building2, Search, X } from 'lucide-react';
import { Company } from '../db/database';
import { searchCompanies } from '../services/companyService';

interface CompanyAutocompleteProps {
  userId: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (company: Company) => void;
  placeholder?: string;
  className?: string;
}

const CompanyAutocomplete: FC<CompanyAutocompleteProps> = ({
  userId,
  value,
  onChange,
  onSelect,
  placeholder = 'Nom de la société',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Company[]>([]);
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
      if (!userId) return;
      
      setLoading(true);
      try {
        const results = await searchCompanies(userId, value);
        setSuggestions(results);
      } catch (error) {
        console.error('Erreur recherche entreprises:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(debounce);
  }, [userId, value]);

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

  const handleSelect = (company: Company) => {
    onChange(company.nom);
    onSelect(company);
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="input w-full pl-10 pr-8"
          autoComplete="off"
        />
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown des suggestions */}
      {isOpen && (suggestions.length > 0 || loading) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
          {loading ? (
            <div className="p-3 text-center text-gray-500">
              <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto"></div>
            </div>
          ) : (
            <>
              {suggestions.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50">
                    Entreprises enregistrées
                  </div>
                  {suggestions.map((company, index) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => handleSelect(company)}
                      className={`w-full px-3 py-2 text-left flex items-start gap-3 transition-colors ${
                        index === selectedIndex
                          ? 'bg-primary-50'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                        index === selectedIndex ? 'bg-primary-100' : 'bg-gray-100'
                      }`}>
                        <Building2 className={`w-4 h-4 ${
                          index === selectedIndex ? 'text-primary-600' : 'text-gray-500'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {company.nom}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {[
                            company.rc && `RC: ${company.rc}`,
                            company.cnss && `CNSS: ${company.cnss}`,
                          ].filter(Boolean).join(' • ') || 'Aucune info supplémentaire'}
                        </p>
                      </div>
                      {company.usageCount > 1 && (
                        <span className="flex-shrink-0 text-xs text-gray-400">
                          {company.usageCount}x
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Message d'aide */}
      {isOpen && !loading && suggestions.length === 0 && value.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Search className="w-4 h-4" />
            <span>Nouvelle entreprise - les infos seront sauvegardées automatiquement</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyAutocomplete;
