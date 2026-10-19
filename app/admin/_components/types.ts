/** Result returned by admin server actions used with useActionState. */
export type ActionState = { ok?: string; error?: string; fields?: Record<string, string> } | null;

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
