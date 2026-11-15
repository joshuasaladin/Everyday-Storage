/** Next runs this once when the server starts — where the job scheduler is set going. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/jobs");
  startScheduler();
}
