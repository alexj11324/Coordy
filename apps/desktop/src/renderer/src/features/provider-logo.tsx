import { Monitor } from "lucide-react";
import { useState } from "react";
import { providerKey } from "../lib/coordy/labels";

export const FIRST_CLASS_PROVIDER_IDS = [
  "claude",
  "codebuddy",
  "codex",
  "copilot",
  "opencode",
  "deveco",
  "openclaw",
  "hermes",
  "pi",
  "omp",
  "cursor",
  "kimi",
  "reasonix",
  "dsh",
  "kiro",
  "antigravity",
  "qoder",
  "qoderclicn",
  "traecli",
  "grok",
  "qwen",
  "qwenpaw",
  "mcode",
  "gemini",
] as const;

type FirstClassProviderId = (typeof FIRST_CLASS_PROVIDER_IDS)[number];
type LogoProps = { className: string };

/** Shared local assets rendered from Multica's current ProviderLogo source. */
export const FIRST_CLASS_ICON_FILES: Record<FirstClassProviderId, string> = {
  claude: "claude.svg",
  codebuddy: "codebuddy.svg",
  codex: "codex.svg",
  copilot: "copilot.svg",
  opencode: "opencode.svg",
  deveco: "deveco.png",
  openclaw: "openclaw.svg",
  hermes: "hermes.webp",
  pi: "pi.svg",
  omp: "omp.svg",
  cursor: "cursor.svg",
  kimi: "kimi.svg",
  reasonix: "reasonix.svg",
  dsh: "dsh.svg",
  kiro: "kiro.svg",
  antigravity: "antigravity.png",
  qoder: "qoder.svg",
  qoderclicn: "qoderclicn.svg",
  traecli: "traecli.png",
  grok: "grok.svg",
  qwen: "qwen.svg",
  qwenpaw: "qwenpaw.svg",
  mcode: "mcode.svg",
  gemini: "gemini.svg",
};

const ICON_ASSETS = import.meta.glob<string>("../assets/provider-icons/*", {
  eager: true,
  query: "?url",
  import: "default",
});

const FIRST_CLASS_ICONS = Object.fromEntries(
  Object.entries(FIRST_CLASS_ICON_FILES).map(([provider, file]) => [
    provider,
    ICON_ASSETS[`../assets/provider-icons/${file}`],
  ]),
) as Record<FirstClassProviderId, string>;

export function firstClassIconSignature(provider: string): string | null {
  const file =
    FIRST_CLASS_ICON_FILES[providerKey(provider) as FirstClassProviderId];
  return file ? `multica-local:${file}` : null;
}

export function registryIconUrl(provider: string): string | null {
  const id = provider.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return null;
  return `https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`;
}

function RegistryLogo({
  provider,
  className,
}: LogoProps & { provider: string }) {
  const [failed, setFailed] = useState(false);
  const src = registryIconUrl(provider);
  if (!src || failed) return <Monitor className={className} />;
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function ProviderLogo({
  provider,
  className,
}: LogoProps & { provider: string }) {
  const src = FIRST_CLASS_ICONS[providerKey(provider) as FirstClassProviderId];
  if (src) return <img src={src} alt="" className={className} />;
  return <RegistryLogo provider={provider} className={className} />;
}
