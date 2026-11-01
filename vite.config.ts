import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function githubPagesBundleCompatPlugin(): Plugin {
  return {
    name: 'github-pages-bundle-compat',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      return html.replace(
        '<script id="gh-pages-boot-flag">',
        '<script id="gh-pages-boot-flag">window.__IS_VITE_DIST_BUILD__ = true;'
      );
    },
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;

      // Copy firebase-applet-config.json and src/ into dist/ so any legacy cached client
      // attempting to fetch source files from gh-pages never hits a 404 error.
      const firebaseCfg = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(firebaseCfg)) {
        fs.copyFileSync(firebaseCfg, path.join(distDir, 'firebase-applet-config.json'));
      }

      const srcDir = path.resolve(__dirname, 'src');
      const distSrcDir = path.join(distDir, 'src');
      if (fs.existsSync(srcDir)) {
        fs.cpSync(srcDir, distSrcDir, { recursive: true });
      }

      // Also provide unhashed aliases assets/app.js and assets/app.css for backwards compatibility
      const assetsDir = path.join(distDir, 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        const hashedJs = files.find((f) => /^app-[a-zA-Z0-9_-]+\.js$/.test(f));
        const hashedCss = files.find((f) => /^(?:app|index)-[a-zA-Z0-9_-]+\.css$/.test(f));
        if (hashedJs) {
          fs.copyFileSync(path.join(assetsDir, hashedJs), path.join(assetsDir, 'app.js'));
        }
        if (hashedCss) {
          fs.copyFileSync(path.join(assetsDir, hashedCss), path.join(assetsDir, 'app.css'));
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), githubPagesBundleCompatPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
