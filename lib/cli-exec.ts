import { execFile } from 'child_process'

type CliExecOptions = {
  encoding: 'utf8'
  timeout: number
  maxBuffer: number
  windowsHide: boolean
}

/** Run a non-interactive CLI without leaving its stdin pipe open. */
export function execCli(
  command: string,
  args: string[],
  options: CliExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr })
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })

    // Passing a prompt as an argument is sufficient; an open pipe makes some
    // CLIs wait forever for an additional prompt from stdin.
    child.stdin?.end()
  })
}
