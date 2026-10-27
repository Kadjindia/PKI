# SSI Dashboard — KPI SSI

Tableau de bord de pilotage de la sécurité des systèmes d'information : indicateurs (KPI), gouvernance, risques, sensibilisation, messagerie et monitoring des outils de sécurité (BitSight, Cortex, QRadar, Varonis…).

## Stack

| Couche | Technologies |
|---|---|
| Front | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, React Query |
| Back | Supabase : authentification, PostgreSQL (RLS), stockage, Edge Functions (Deno) |
| Livraison | Image Docker nginx (fichiers statiques) |

## Structure

```
src/
  pages/            Pages (connexion, tableau de bord, gouvernance, risques…)
  components/       Composants par domaine (dashboard, monitoring, risks…) et ui/ (shadcn)
  context/          Authentification, KPI, thème
  lib/              Accès aux données Supabase par domaine
  integrations/     Client Supabase et types générés
supabase/
  migrations/       Migrations SQL (à appliquer dans l'ordre)
  functions/        Edge Functions : proxys des outils et traitement des fichiers
Dockerfile          Image nginx servant dist/
nginx.conf          Configuration nginx (routage SPA, cache, en-têtes de sécurité)
```

## Démarrage en local

Prérequis : Node.js 22 et npm.

```bash
npm ci
cp .env.example .env    # puis renseigner les variables (voir ci-dessous)
npm run dev             # http://localhost:8080
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production dans `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Tests (Vitest) |

## Variables d'environnement

### Front (`.env`)

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique (anon / publishable) |
| `VITE_SUPABASE_PROJECT_ID` | Référence du projet |

> ⚠️ Toute variable `VITE_*` est intégrée **en clair** dans le JavaScript envoyé au navigateur, et figée au moment du build. N'y mettre que des valeurs publiques, jamais de jeton d'outil.

### Edge Functions (secrets côté serveur)

À configurer dans Supabase (Cloud : *Edge Functions → Secrets* ; auto-hébergé : variables du service `functions` dans `docker-compose.yml`).

| Fonction | Secrets |
|---|---|
| `qradar-proxy` | `QRADAR_BASE_URL`, `QRADAR_SEC_TOKEN` |
| `cortex-proxy` | `CORTEX_FQDN` (sans `https://`), `CORTEX_API_KEY_ID` (ID numérique), `CORTEX_API_KEY` (clé **Advanced**) |
| `bitsight-proxy` | `BITSIGHT_TOKEN`, `BITSIGHT_COMPANY_GUID` |
| `varonis-proxy` | `VARONIS_BASE_URL`, `VARONIS_API_KEY`, `POSTURE_CRON_SECRET` (secret partagé avec la tâche planifiée, ex. `openssl rand -hex 32`) |
| toutes | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (fournis automatiquement par Supabase) |

## Build et image Docker

`dist/` est construit **avant** l'image : le Dockerfile ne fait que le copier dans nginx.

```bash
npm ci
npm run build
docker build --no-cache -t pki-app .
docker tag pki-app:latest infragit-moe.als.lan/ssi/pki-frontend:latest
docker push infragit-moe.als.lan/ssi/pki-frontend:latest
```

- Image de base : `docker-registry.alsdmz.lan/nginx:1.21-alpine` (modifiable avec `--build-arg REGISTRY=…`).
- Le conteneur écoute sur le port **80**, sous l'utilisateur non root `nginx`.
- Contrôle de santé : `GET /healthz` doit renvoyer `200 ok`.
- Test local : `docker run -d --name pki -p 8080:80 pki-app`, puis http://localhost:8080.

## Supabase

### Migrations

Appliquer les fichiers de `supabase/migrations/` dans l'ordre (`supabase db push`, ou éditeur SQL). La migration `20261021090000_securisation_acces_donnees.sql` :

- retire tout accès aux tables aux visiteurs non connectés (`anon`) ;
- réserve les tables métier aux utilisateurs connectés ;
- limite `users` au profil de chacun, sans pouvoir modifier son propre `role` ;
- interdit l'envoi et le listage anonymes de fichiers dans le bucket `kpi-files`.

### Déploiement des Edge Functions

**Supabase Cloud**

```bash
supabase functions deploy <nom-fonction> --project-ref <ref-projet>
```

**Supabase auto-hébergé** (pas de `functions deploy`) : copier le dossier de la fonction dans `volumes/functions/<nom-fonction>/` sur le serveur, puis :

```bash
docker compose restart functions
```

### Posture des données Varonis (calcul planifié)

La posture (10 recherches Varonis sur des millions d'objets) n'est pas calculée à l'ouverture de l'écran : `varonis-proxy` la calcule par petites étapes (3 recherches en parallèle au plus, pause automatique si Varonis signale trop de requêtes) et enregistre chaque photo dans la table `varonis_posture_snapshots`. L'écran affiche la dernière photo terminée ; « Recalculer » lance un nouveau calcul (un seul à la fois, 15 min minimum entre deux).

Mise en place :

1. appliquer les migrations `20261023090000_varonis_posture_snapshots.sql` et `20261027090000_varonis_posture_summary.sql` (résumé de chaque photo, pour l'évolution dans le temps) ;
2. ajouter le secret `POSTURE_CRON_SECRET` et redéployer `varonis-proxy` ;
3. exécuter une fois `supabase/sql/planification_posture_varonis.sql` (pg_cron + pg_net) après y avoir renseigné l'URL de la fonction, la clé anon et le secret : calcul chaque nuit à 4 h UTC, avancement toutes les 2 minutes.

Sans l'étape 3, le calcul n'avance que lorsque l'écran Posture est ouvert.

Le bloc « Évolution dans le temps » trace une photo par jour (la dernière du jour) depuis le 27/10/2026, date à partir de laquelle les définitions des indicateurs sont stables ; une valeur plafonnée ou reprise d'une photo précédente n'est pas tracée.

### Liste blanche des proxys

`qradar-proxy`, `cortex-proxy` et `bitsight-proxy` ne relaient que les appels déclarés en tête de leur fichier (`ALLOWED_CALLS` / `ALLOWED_PATHS`). Tout autre appel reçoit un **403**. Pour utiliser un nouvel endpoint depuis le front, l'ajouter à cette liste puis redéployer la fonction.

### Types TypeScript

`src/integrations/supabase/types.ts` est généré à partir du schéma de la base. Il doit être régénéré après chaque changement de schéma :

```bash
# Supabase Cloud
supabase gen types typescript --project-id <ref-projet> > src/integrations/supabase/types.ts
# Supabase auto-hébergé
supabase gen types typescript --db-url "postgresql://…" > src/integrations/supabase/types.ts
```

> Le fichier actuel ne décrit qu'une partie des tables, d'où des erreurs `tsc`. Elles ne bloquent pas le build (Vite ne vérifie pas les types).

## Dépendances à surveiller

- `xlsx` (SheetJS) 0.18.5 présente des vulnérabilités connues à la lecture de fichiers piégés. Le correctif (0.20.x) n'est publié que sur `cdn.sheetjs.com` : télécharger l'archive dans `vendor/`, puis `npm install --save ./vendor/xlsx-<version>.tgz`.
- Les alertes `npm audit` restantes sur Tailwind (`braces`, `micromatch`…) ne concernent que les outils de build, pas l'application livrée.
