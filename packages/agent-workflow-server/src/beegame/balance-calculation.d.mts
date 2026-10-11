export function checkCalculationResult(workspace: string, outputPath: string, helperPath?: string): {
  valid: boolean; scope: string; output: string; issues: string[]; unverified: string[]
}
