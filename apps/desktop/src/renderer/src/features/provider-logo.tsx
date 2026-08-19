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
] as const;

type FirstClassProviderId = (typeof FIRST_CLASS_PROVIDER_IDS)[number];
type LogoProps = { className: string };

export type FirstClassIconSourceStatus =
  | "provider-controlled"
  | "exact-registry"
  | "shared-family"
  | "third-party-brand"
  | "legacy-unverified";

type FirstClassIconSource = {
  sourceKind:
    | "provider-package"
    | "provider-repository"
    | "provider-site"
    | "registry"
    | "shared-family"
    | "third-party-library"
    | "legacy-local";
  sourceRef: string;
  status: FirstClassIconSourceStatus;
};

/** Local files shared by the desktop and READMEs. Provenance is recorded below. */
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
};

export const FIRST_CLASS_ICON_SOURCES: Record<
  FirstClassProviderId,
  FirstClassIconSource
> = {
  claude: {
    sourceKind: "third-party-library",
    sourceRef: "https://github.com/twbs/icons/blob/main/icons/claude.svg",
    status: "third-party-brand",
  },
  codebuddy: {
    sourceKind: "provider-package",
    sourceRef: "npm:@tencent-ai/codebuddy-code/dist/web-ui/logo.svg",
    status: "provider-controlled",
  },
  codex: {
    sourceKind: "third-party-library",
    sourceRef: "https://github.com/twbs/icons/blob/main/icons/openai.svg",
    status: "third-party-brand",
  },
  copilot: {
    sourceKind: "provider-repository",
    sourceRef:
      "https://github.com/primer/octicons/blob/main/icons/copilot-48.svg",
    status: "provider-controlled",
  },
  opencode: {
    sourceKind: "provider-repository",
    sourceRef: "https://github.com/anomalyco/opencode",
    status: "provider-controlled",
  },
  deveco: {
    sourceKind: "legacy-local",
    sourceRef: "DevEco Studio devecostudio.icns; no distributable source recorded",
    status: "legacy-unverified",
  },
  openclaw: {
    sourceKind: "legacy-local",
    sourceRef: "legacy inline recreation; no upstream asset recorded",
    status: "legacy-unverified",
  },
  hermes: {
    sourceKind: "legacy-local",
    sourceRef: "legacy bundled WebP; upstream URL and license not recorded",
    status: "legacy-unverified",
  },
  pi: {
    sourceKind: "provider-site",
    sourceRef: "https://pi.dev/logo.svg",
    status: "provider-controlled",
  },
  omp: {
    sourceKind: "shared-family",
    sourceRef: "pi",
    status: "shared-family",
  },
  cursor: {
    sourceKind: "legacy-local",
    sourceRef: "legacy bundled Cursor-shaped path; source URL not recorded",
    status: "legacy-unverified",
  },
  kimi: {
    sourceKind: "registry",
    sourceRef: "https://cdn.agentclientprotocol.com/registry/v1/latest/kimi.svg",
    status: "exact-registry",
  },
  reasonix: {
    sourceKind: "provider-site",
    sourceRef: "https://reasonix.io/logo.svg",
    status: "provider-controlled",
  },
  dsh: {
    sourceKind: "provider-repository",
    sourceRef:
      "https://github.com/deepseek-ai/deepseek-harness/blob/main/apps/web/public/favicon.svg",
    status: "provider-controlled",
  },
  kiro: {
    sourceKind: "provider-site",
    sourceRef: "https://kiro.dev/icon.svg",
    status: "provider-controlled",
  },
  antigravity: {
    sourceKind: "legacy-local",
    sourceRef: "legacy bundled PNG; provider asset source not recorded",
    status: "legacy-unverified",
  },
  qoder: {
    sourceKind: "provider-site",
    sourceRef:
      "https://img.alicdn.com/imgextra/i3/O1CN01KliT1u1jEq947NlKH_!!6000000004517-55-tps-180-180.svg",
    status: "provider-controlled",
  },
  qoderclicn: {
    sourceKind: "shared-family",
    sourceRef: "qoder",
    status: "shared-family",
  },
  traecli: {
    sourceKind: "legacy-local",
    sourceRef: "legacy bundled PNG; provider asset source not recorded",
    status: "legacy-unverified",
  },
  grok: {
    sourceKind: "registry",
    sourceRef:
      "https://cdn.agentclientprotocol.com/registry/v1/latest/grok-build.svg",
    status: "exact-registry",
  },
  qwen: {
    sourceKind: "provider-repository",
    sourceRef:
      "https://github.com/QwenLM/qwen-code/tree/main/packages/desktop/apps/electron/resources/brands/qwen-code",
    status: "provider-controlled",
  },
  qwenpaw: {
    sourceKind: "provider-repository",
    sourceRef:
      "https://github.com/agentscope-ai/QwenPaw/blob/main/console/public/logo-light.svg",
    status: "provider-controlled",
  },
  mcode: {
    sourceKind: "legacy-local",
    sourceRef: "legacy bundled MiniMax-shaped path; exact source not recorded",
    status: "legacy-unverified",
  },
};

const ICON_ASSETS = import.meta.glob<string>("../assets/provider-icons/*", {
  eager: true,
  query: "?url",
  import: "default",
});

export function resolveFirstClassIconAssets(
  assets: Readonly<Record<string, string>>,
): Record<FirstClassProviderId, string> {
  const entries = FIRST_CLASS_PROVIDER_IDS.map((provider) => {
    const assetPath = `../assets/provider-icons/${FIRST_CLASS_ICON_FILES[provider]}`;
    const source = assets[assetPath];
    if (!source) {
      throw new Error(
        `Missing local icon asset for first-class provider "${provider}": ${assetPath}`,
      );
    }
    return [provider, source] as const;
  });
  return Object.fromEntries(entries) as Record<FirstClassProviderId, string>;
}

const FIRST_CLASS_ICONS = resolveFirstClassIconAssets(ICON_ASSETS);

export function firstClassIconSignature(provider: string): string | null {
  const file =
    FIRST_CLASS_ICON_FILES[providerKey(provider) as FirstClassProviderId];
  return file ? `provider-local:${file}` : null;
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
