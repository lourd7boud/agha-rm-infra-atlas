import { revalidatePath } from 'next/cache';
import { apiGet, apiPost } from '@/lib/api';
import type { Employee } from '@/lib/projects';

interface EmployeeFull extends Employee {
  cin?: string;
  phone?: string;
}

export default async function PeoplePage() {
  const employees = await apiGet<EmployeeFull[]>('/people/employees');

  async function createEmployee(formData: FormData) {
    'use server';
    const fullName = String(formData.get('fullName') ?? '').trim();
    const metier = String(formData.get('metier') ?? '').trim();
    if (fullName.length >= 3 && metier.length >= 2) {
      await apiPost('/people/employees', {
        fullName,
        metier,
        cin: String(formData.get('cin') ?? '') || undefined,
        phone: String(formData.get('phone') ?? '') || undefined,
      });
      revalidatePath('/people');
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Personnel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre du personnel — les affectations se gèrent sur la fiche de
          chaque chantier
        </p>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Effectif ({employees.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Métier</th>
              <th className="px-4 py-3">CIN</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td className="px-4 py-3 font-semibold">{employee.fullName}</td>
                <td className="px-4 py-3 text-slate-600">{employee.metier}</td>
                <td className="px-4 py-3 font-mono text-xs">{employee.cin ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {employee.phone ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      employee.status === 'actif'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {employee.status === 'actif' ? 'Actif' : 'Inactif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {employees.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            Aucun employé enregistré.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Nouvel employé
        </h2>
        <form action={createEmployee} className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-sm">
            <span className="mb-1 block text-xs text-slate-500">Nom complet</span>
            <input
              type="text"
              name="fullName"
              required
              minLength={3}
              maxLength={200}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-slate-500">Métier</span>
            <input
              type="text"
              name="metier"
              required
              minLength={2}
              maxLength={100}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">CIN</span>
            <input
              type="text"
              name="cin"
              maxLength={20}
              className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">Téléphone</span>
            <input
              type="text"
              name="phone"
              maxLength={30}
              className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
            Enregistrer
          </button>
        </form>
      </section>
    </div>
  );
}
