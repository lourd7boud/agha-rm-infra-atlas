import { FC, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../db/database';
import { logSyncOperation } from '../../services/syncService';
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { isWeb } from '../../utils/platform';
import { apiService } from '../../services/apiService';

interface Props {
  projectId: string;
  onClose: () => void;
  onImported: (bordereauId: string) => void;
}

interface ParsedLine {
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
  isValid: boolean;
  error?: string;
}

const ImportExcelModal: FC<Props> = ({ projectId, onClose, onImported }) => {
  const { user } = useAuthStore();
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [designation, setDesignation] = useState('');
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError('');
    setIsProcessing(true);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];

      // Skip header row and parse
      const lines: ParsedLine[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        // Skip empty rows
        if (!row || row.length === 0 || !row.some(cell => cell)) continue;

        // Try to parse the row
        const numero = parseInt(row[0]) || i;
        const designation = String(row[1] || '').trim();
        const unite = String(row[2] || 'M³').trim();
        const quantite = parseFloat(row[3]) || 0;
        const prixUnitaire = parseFloat(row[4]) || 0;
        const montant = quantite * prixUnitaire;

        let isValid = true;
        let error = '';

        if (!designation) {
          isValid = false;
          error = 'Désignation manquante';
        }

        lines.push({
          numero,
          designation,
          unite,
          quantite,
          prixUnitaire,
          montant,
          isValid,
          error,
        });
      }

      setParsedLines(lines);
      
      // Auto-fill reference from filename
      if (!reference) {
        const filename = selectedFile.name.replace(/\.[^/.]+$/, '');
        setReference(filename);
      }
    } catch (err) {
      setError('Erreur lors de la lecture du fichier. Vérifiez le format Excel.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!user || !reference.trim() || !designation.trim() || parsedLines.length === 0) {
      alert('Veuillez remplir tous les champs et charger un fichier valide');
      return;
    }

    const validLines = parsedLines.filter(l => l.isValid);
    if (validLines.length === 0) {
      alert('Aucune ligne valide à importer');
      return;
    }

    const bordereauId = `bordereau:${uuidv4()}`;
    const now = new Date().toISOString();

    const lignes = validLines.map((line, index) => ({
      id: uuidv4(),
      numero: index + 1,
      designation: line.designation,
      unite: line.unite,
      quantite: line.quantite,
      prixUnitaire: line.prixUnitaire,
      montant: line.montant,
    }));

    const montantTotal = lignes.reduce((sum, l) => sum + l.montant, 0);

    const newBordereau = {
      id: bordereauId,
      projectId: projectId,
      userId: user.id,
      reference: reference.trim(),
      designation: designation.trim(),
      lignes,
      montantTotal,
      createdAt: now,
      updatedAt: now,
    };

    if (isWeb()) {
      // Web: use API
      await apiService.createBordereau({
        projectId: projectId.replace('project:', ''),
        reference: reference.trim(),
        designation: designation.trim(),
        lignes,
        montantTotal,
      });
    } else {
      // Electron: use IndexedDB
      await db.bordereaux.add(newBordereau);
      await logSyncOperation('CREATE', 'bordereau', bordereauId.replace('bordereau:', ''), newBordereau, user.id);
    }

    onImported(bordereauId);
  };

  const validCount = parsedLines.filter(l => l.isValid).length;
  const invalidCount = parsedLines.filter(l => !l.isValid).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Importer depuis Excel</h3>
            <p className="text-sm text-gray-600 mt-1">
              Format attendu: N°, Désignation, Unité, Quantité, Prix unitaire
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Info Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Référence *
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="input w-full"
                placeholder="Ex: BPU-2024-01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Désignation *
              </label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="input w-full"
                placeholder="Ex: Bordereau importé"
              />
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fichier Excel (.xlsx, .xls)
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-500 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                id="excel-upload"
              />
              <label htmlFor="excel-upload" className="cursor-pointer">
                <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                {file ? (
                  <div>
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-gray-900">Cliquer pour sélectionner un fichier</p>
                    <p className="text-sm text-gray-500 mt-1">ou glisser-déposer</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <p className="text-sm text-red-900">{error}</p>
            </div>
          )}

          {/* Preview */}
          {parsedLines.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-gray-900">Aperçu des données</h4>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    {validCount} valides
                  </span>
                  {invalidCount > 0 && (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      {invalidCount} erreurs
                    </span>
                  )}
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">N°</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Désignation</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">U</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Qté</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">P.U</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Montant</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsedLines.map((line, index) => (
                        <tr
                          key={index}
                          className={line.isValid ? '' : 'bg-red-50'}
                        >
                          <td className="px-3 py-2">{line.numero}</td>
                          <td className="px-3 py-2">{line.designation || <span className="text-gray-400">-</span>}</td>
                          <td className="px-3 py-2">{line.unite}</td>
                          <td className="px-3 py-2 text-right">{line.quantite}</td>
                          <td className="px-3 py-2 text-right">{line.prixUnitaire.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">{line.montant.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">
                            {line.isValid ? (
                              <CheckCircle className="w-4 h-4 text-green-600 mx-auto" />
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <AlertCircle className="w-4 h-4 text-red-600" />
                                <span className="text-xs text-red-600">{line.error}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
              <p className="ml-3 text-gray-600">Traitement du fichier...</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Annuler
            </button>
            <button
              onClick={handleImport}
              disabled={parsedLines.length === 0 || validCount === 0 || !reference.trim() || !designation.trim()}
              className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Importer {validCount > 0 && `(${validCount} lignes)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportExcelModal;
