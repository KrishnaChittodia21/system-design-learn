/** Short phase name for compact UI: "Messaging & Data Pipelines" → "Messaging", "Low-Level Design (LLD) & …" → "Low-Level Design". */
export const shortTitle = (title: string) => title.split(/ & |: | \(| →/)[0];
