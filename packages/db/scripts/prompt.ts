import { createInterface } from "node:readline";

/** Ask a visible question (e.g. "y/N"). */
export function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    // No keyboard (input closed or piped): treat as "no" rather than waiting forever.
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}
