# Cloudflare Pages V2 Deployment

This branch contains a self-contained static 3D Camera & Pose Planner Version 2. The older `camera-v2` git submodule has been removed from this branch **and** from `main` (with the original export preserved at `backup-grok-original-2026-10-23`).

Cloudflare Pages settings:
- **GitHub repository:** `rahmanmehdi4-png/AI-Camera`
- **Production branch:** `cloudflare-v2` or `main` (both now contain V2)
- **Root directory:** repository root
- **Build command:** `npm run build`
- **Build output:** `dist`
- **Node version:** 22

A push to either branch should trigger a new Git-integrated Pages build if automatic deployments are enabled for the branch.

**Important:** Ignore or do not retry an older failed deployment tied to commit `ae5164baa228231e648baa18a1e1cbd32f5c2369`: that tree contains the broken gitlink. Start a new build against the latest branch commit. If a new build still fails before checking out the source, review the Cloudflare GitHub App installation/repository access as Cloudflare documents.

No claim of production build success is made until Pages deploys the app.
