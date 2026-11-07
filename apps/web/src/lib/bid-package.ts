export function packageChecklist(
  requirements: readonly { id: string; code: string; required: boolean }[],
  files: readonly { requirementId: string }[],
) {
  const attached = new Set(files.map((file) => file.requirementId));
  const mandatory = requirements.filter((requirement) => requirement.required);
  const missingCodes = mandatory
    .filter((requirement) => !attached.has(requirement.id))
    .map((requirement) => requirement.code)
    .sort();
  return {
    required: mandatory.length,
    satisfied: mandatory.length - missingCodes.length,
    missingCodes,
    complete: mandatory.length > 0 && missingCodes.length === 0,
  };
}
