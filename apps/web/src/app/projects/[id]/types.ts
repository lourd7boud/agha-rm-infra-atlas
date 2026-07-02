import type { ProjectSummary, Situation } from '@/lib/projects';

export interface ProjectDetail extends ProjectSummary {
  situations: Situation[];
}

/** Inline server action (closure over the project id) passed from the page to
 *  a section's <form action>. */
export type ProjectFormAction = (formData: FormData) => Promise<void>;
