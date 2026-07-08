import { FC, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreate: (data: { reference: string; designation: string }) => void;
}

const CreateBordereauModal: FC<Props> = ({ onClose, onCreate }) => {
  const [reference, setReference] = useState('');
  const [designation, setDesignation] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reference.trim() && designation.trim()) {
      onCreate({ reference: reference.trim(), designation: designation.trim() });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Nouveau bordereau</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Référence *
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input"
              placeholder="Ex: BPU-2024-01"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Désignation *
            </label>
            <textarea
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className="input"
              rows={3}
              placeholder="Ex: Bordereau des Prix Unitaires - Terrassement"
              required
            />
          </div>

          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              Annuler
            </button>
            <button type="submit" className="btn btn-primary flex-1">
              Créer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateBordereauModal;
