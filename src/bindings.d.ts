export { };

declare global {
  /**
   * Cloudflare defined environment varables.
   */
  const TELEGRAM_KEY: string;
  const OPENAI_SECRET: string;
  const OPENAI_PUBLISHABLE: string;

  /**
   * Workers KV namespace references.
   */
  const TIMDB: KVNamespace;
}
