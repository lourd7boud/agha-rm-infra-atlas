export type ExpenseTreatment = 'standalone' | 'linked_resource' | 'non_cost';
export type ResourceKind = 'main_oeuvre' | 'materiel' | 'consommation';
export interface ExpenseReconciliationRecord {
  version: number;
  expenseId: string;
  projectId: string;
  treatment: ExpenseTreatment;
  resourceKind: ResourceKind | null;
  resourceId: string | null;
  expenseAmountMad: number;
  resourceAmountMad: number | null;
  note: string;
  actor: string;
  updatedAt: string;
  history: Array<{
    treatment: ExpenseTreatment;
    note: string;
    actor: string;
    updatedAt: string;
  }>;
}
export interface ExpenseReconciliationInput {
  expectedVersion: number;
  treatment: ExpenseTreatment;
  resourceKind?: ResourceKind;
  resourceId?: string;
  note: string;
}
export interface ReconciliationResource {
  id: string;
  kind: ResourceKind;
  label: string;
  amount: number;
}
