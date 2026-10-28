# Camera & Pose Planner V2.1 deployment

## Observed failure and repository state

The GitHub check attached to AI-Camera commit 383724ab8014d0ec7a6712d2e4fa12f6cf1fda5c is **Workers Builds: ai-camera**, not a Pages build. Its build ID is e245a5f0-c956-4926-a2f8-d44fc6427a5d. It failed before compilation. The check confirms the corrected repository and commit were selected; it does not expose detailed clone logs.

Both main at 383724ab and cloudflare-v2 at 1b126292 have no .gitmodules file or mode-160000 gitlinks. A fresh recursive clone of cloudflare-v2 and recursive submodule update succeeded during this correction. The historical backup-grok-original-2026-10-23 branch still contains the original broken camera-v2 gitlink and is intentionally preserved. A normal checkout of either release branch does not traverse that historical tree.

The later main commit 6097c02 also has a failed Workers Builds check (build ID 5d16d626-4ed7-4d3f-80a7-544b9f317411), with no detailed error log exposed through GitHub. The exact remaining Cloudflare-side cloning cause is **not verified**: the account dashboard requires authentication. Repository cleanup alone must not be described as a successful Cloudflare deployment. Review the detailed log, GitHub App installation access, root directory and build cache in that account. Do not retry the original ae5164b build or select the backup branch.

## Correct production configuration

- Repository: rahmanmehdi4-png/AI-Camera.
- Branch: main (cloudflare-v2 is synchronized to the same release).
- Root directory: repository root; never camera-v2.
- Node.js: 22 (.nvmrc, .node-version and package engines).
- Install: npm ci --ignore-scripts.
- Build: npm run build.
- Static output directory: dist.
- Entry: index.html -> src/main-v2.tsx -> PlannerApp -> Viewport -> Stage -> Mannequin.

For **Workers Builds**, use the included wrangler.jsonc and deploy command `npx wrangler deploy`. It serves dist with SPA fallback and requires no server runtime. A local `wrangler deploy --dry-run` accepted this configuration.

For **Pages**, choose the Vite/static preset, build command npm run build and output dist. Pages and Workers have different deployment settings; a Pages output-directory instruction does not configure a Workers deployment by itself.

## Bypass repository cloning

The delivered Camera-Pose-Planner-V2.1-Website.zip contains compiled files, with index.html at the ZIP root. Upload it to a new Cloudflare Pages Direct Upload project, or unzip and run `npx wrangler pages deploy <unzipped-directory> --project-name <your-pages-project>`. Both avoid Cloudflare cloning Git submodules. A ZIP file is supported by the dashboard's drag-and-drop route; Wrangler takes the extracted directory.

An alternative hosted deployment is also provided in the release response. This is separate from the user's existing Cloudflare integration and does not replace its account configuration.

Sources:
- https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- https://developers.cloudflare.com/pages/get-started/direct-upload/

## Preview and release identity

startup.sh resolves its own directory and no longer assumes /workspace/camera-v2. The development repository's main branch previously loaded V1; its v2-release-candidate branch matched the V2 files in AI-Camera. The correction synchronizes the V2 release source and preserves the earlier main as a backup.

The visible badge is V2.1. dist/release.json records the source commit, source-content hash, Node version, main-v2 entry and sculpted-2.1 renderer. The build verifier rejects output that omits that renderer. Online navigation prefers fresh HTML; offline navigation and local fonts/assets remain cached. User project storage keys and the version-1 project schema remain unchanged.
