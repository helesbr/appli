# Gourde connectée : motion design (30 s)

Vidéo de présentation du projet étudiant **Gourde connectée** (EPF, FGE3, planification de projet), conçu pour la Decathlon CMA CGM Team. Réalisée avec [Remotion](https://www.remotion.dev/) (React + TypeScript).

## Livrables (`out/`)

| Fichier | Format |
| --- | --- |
| `gourde-connectee-16x9.mp4` | 1920×1080, 30 fps, 30 s, H.264 |
| `gourde-connectee-9x16.mp4` | 1080×1920, 30 fps, 30 s, H.264 (réseaux sociaux) |
| `miniature-scene4.png` | Miniature 1920×1080 (scène 4, image 500) |

## Démarrer

```bash
cd gourde-motion
npm install
npm run studio          # prévisualisation interactive (http://localhost:3000)
npm run render:all      # 16:9 + 9:16 + miniature
```

## Structure

```
src/
  lib/timing.ts      ← début et durée de chaque scène, durée des transitions
  lib/theme.ts       ← couleurs (#0F2742, #0891B2…) et polices (Bebas Neue, Lato)
  lib/assets.ts      ← images et repères mesurés dessus (patch, LED, jauge…)
  lib/anim.ts        ← easings et ressorts (aucune animation linéaire)
  scenes/            ← une scène par fichier (Scene1Hook … Scene6Outro)
  components/        ← texte cinétique, transitions, gourde, jauge, fonds…
  Main.tsx           ← assemblage des scènes, transitions et musique optionnelle
  Root.tsx           ← compositions (vidéo complète + chaque scène seule, 16:9 et 9:16)
public/
  affiche.jpg, produit.png   ← images fournies
  cutouts/                   ← gourde et smartphone détourés depuis produit.png
  fonts/                     ← Bebas Neue et Lato (Google Fonts, licence OFL)
  music.mp3                  ← (optionnel) piste audio
scripts/stills.mjs           ← images de contrôle de chaque scène (16:9 et 9:16)
```

| Scène | Fichier | Temps | Images |
| --- | --- | --- | --- |
| 1. Accroche | `Scene1Hook.tsx` | 0–4 s | 0–119 |
| 2. Problème | `Scene2Problem.tsx` | 4–9 s | 120–269 |
| 3. Le patch | `Scene3Patch.tsx` | 9–15 s | 270–449 |
| 4. La gourde | `Scene4Bottle.tsx` | 15–21 s | 450–629 |
| 5. L'appli | `Scene5App.tsx` | 21–26 s | 630–779 |
| 6. Clôture | `Scene6Outro.tsx` | 26–30 s | 780–899 |

Chaque scène gère les deux formats : `useLayout()` renvoie `portrait` et la scène place ses éléments en conséquence.

## Modifier et re-rendre une scène

1. Modifier le fichier de la scène (ex. `src/scenes/Scene3Patch.tsx`) ; pour la retimer, modifier `src/lib/timing.ts`.
2. Prévisualiser la scène seule : `npm run studio`, puis dossier `Scenes-16x9` ou `Scenes-9x16`.
3. Rendre la scène seule :

```bash
npx remotion render S3-Patch-16x9 out/scene3-16x9.mp4 --codec=h264 --crf=18
npx remotion render S3-Patch-9x16 out/scene3-9x16.mp4 --codec=h264 --crf=18
```

Identifiants : `S1-Accroche`, `S2-Probleme`, `S3-Patch`, `S4-Gourde`, `S5-Appli`, `S6-Cloture` (suffixe `-16x9` ou `-9x16`).

4. Re-rendre la vidéo complète : `npm run render:all`, ou seulement une plage de la vidéo complète, avec ses transitions :

```bash
npx remotion render GourdeConnectee out/extrait.mp4 --codec=h264 --frames=258-449
```

Images de contrôle : `node scripts/stills.mjs out/stills` (ou `node scripts/stills.mjs out/stills 300,420` pour des images précises).

## Musique (optionnelle)

Déposer un fichier `public/music.mp3` puis relancer le rendu : il est détecté automatiquement, avec un fondu d'entrée (1 s) et de sortie (1,5 s). Sans ce fichier, la vidéo est muette.

## Notes

- Les noms de marque n'apparaissent qu'en texte simple ou à travers les images fournies ; aucun logo n'est redessiné.
- La jauge du smartphone (0 → 78 %) est redessinée par-dessus l'écran de `produit.png`.
- Les polices sont embarquées (`@remotion/fonts`) : le rendu ne dépend pas du réseau.
