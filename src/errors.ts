export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };

  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.code === "object_not_found" ||
    /not\s+found/i.test(candidate.message ?? "")
  );
}
