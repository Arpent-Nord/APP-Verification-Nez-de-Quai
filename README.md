# Contrôle nez de quai – acceptation de coulée

Application web, utilisable sur le chantier (téléphone, tablette ou portable), pour contrôler le coffrage du nez de quai avant le bétonnage. Elle compare le coffrage :

1. à l'**alignement théorique** de la voie (fichiers GEDO `.sie`) ;
2. au **TQC du rail intérieur** relevé au track shoe (as-built). C'est cette comparaison qui sert à **accepter ou refuser la coulée**.

Elle ajoute ensuite le levé au **classeur Excel cumulatif** (*ADM_NouvLR_Connect-Cite_Deviation_Comparison*), affiche le résultat et le transmet par courriel.

> **Confidentialité :** tous les calculs se font dans le navigateur de l'appareil. Aucun fichier (FRT, alignements, Excel) n'est envoyé sur Internet ni dans GitHub.

## Utilisation au chantier

1. Ouvrir le lien GitHub Pages de l'application. On peut l'ajouter à l'écran d'accueil : elle fonctionne ensuite **hors ligne**.
2. **Rapport FRT (.txt)** : le rapport Leica du levé (points codés `178` = rail intérieur TQC, `147` = coffrage).
3. **Alignements (.sie)** : un fichier par voie (ex. `V1ADM.sie`, `V3ADM.sie`). Avec la case cochée, ils sont mémorisés sur l'appareil et rechargés automatiquement aux visites suivantes.
4. **Dernier Excel cumulatif (.xlsx)** : le classeur à jour (celui produit au levé précédent).
5. **Calculer** affiche :
   - le verdict **COULÉE ACCEPTÉE / REFUSÉE** : tous les écarts as-built doivent être dans ± 5 mm en H et en V (tolérances modifiables dans *Paramètres*) ;
   - le tableau des points de coffrage, par voie ;
   - les graphiques H et V, avec la bande de tolérance et l'historique déjà présent dans l'Excel (NouvLR et Connect-Cité).
6. **Générer l'Excel** : le levé est ajouté au classeur, que l'on peut aussitôt consulter dans l'application, onglet par onglet.
7. **Partager / Courriel** ouvre le partage du téléphone (Mail, Outlook, Teams…) avec l'Excel déjà joint et un résumé en texte. Sur un ordinateur sans partage natif, l'Excel est téléchargé et un courriel prérempli s'ouvre ; il faut alors joindre le fichier à la main.

## Ce que l'application ajoute dans l'Excel

- **Onglets `HORIZONTAL_TRACK 01/03` et `VERTICAL_TRACK 01/03`** :
  - les lignes NouvLR du levé (chaînage, Δ vs théorique, Δ vs as-built) sont ajoutées dans l'ordre des chaînages ;
  - la **colonne A** reçoit une cellule fusionnée avec le nom du levé, sa date et la plage de chaînages ;
  - les valeurs déjà présentes (NouvLR antérieur et Connect-Cité) sont conservées, et Connect-Cité reste alignée par chaînage.
- **Graphiques** : ce sont ceux d'origine, avec les zones de texte (+/−). Leurs plages sont mises à jour, et la ligne 0 est une série native alimentée par les cellules `AA1:AB3`.
- **Nouvel onglet `Calculs <nom du levé>`** :
  - l'en-tête du levé : station, résiduels, fermetures, alignements et verdict ;
  - les points de coffrage et les rails TQC, avec des formules Excel ;
  - le contrôle du TQC par rapport à l'axe théorique (écart à ½ écartement et en Z).
- **Protections** : un levé déjà présent dans le classeur est refusé, pour éviter les doublons.
- **Gabarit d'origine** (sans colonne A « Levé ») : il est accepté et converti automatiquement.

## Méthode de calcul

| | Formule | Nominal |
|---|---|---|
| ΔH vs théorique | (\|déport coffrage / axe\| − 1.585) × 1000 | 1.585 m |
| ΔV vs théorique | (Z coffrage − Z profil − 0.980) × 1000 | 0.980 m |
| ΔH vs as-built (retenu) | (\|Éc FRT\| − 0.8675) × 1000 | 0.8675 m = 1.585 − 1.435/2 |
| ΔV vs as-built (retenu) | (d.Z FRT − 0.980) × 1000 | 0.980 m |

- **Chaînage et déport** : projection perpendiculaire sur l'alignement en plan de la voie la plus proche. Les éléments en plan (droites, courbes, spirales) sont intégrés tous les 5 mm ; le profil en long suit des courbes verticales paraboliques.
- **As-built** : les valeurs **Éc / d.Z du rapport FRT** sont retenues, car l'instrument les calcule en pleine précision. Le même calcul refait à partir des coordonnées arrondies au mm figure à titre de contrôle (colonnes T-U de l'onglet Calculs) ; l'écart possible est de ±1 mm.
- **Signes** : ΔH positif = coffrage plus loin de la voie que prévu ; ΔV positif = coffrage trop haut.
- **Codification des chaînages** : `1405478.56` = voie 1, ch. 405+478.56 ; `3405478.96` = voie 3, ch. 405+478.96.

## Publier sur GitHub Pages (une seule fois, ~5 min)

1. Sur github.com : **New repository**, nommé par ex. `nez-de-quai`. Le dépôt peut être **public** : il ne contient que le code, aucune donnée de projet. Pour un dépôt privé, il faut un forfait GitHub payant (Pro, Team ou Enterprise) pour activer Pages.
2. **Add file → Upload files** : glisser *le contenu* de ce dossier (`index.html`, `css/`, `js/`, `vendor/`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `.nojekyll`, `README.md`), puis **Commit changes**.
   Avec git, l'équivalent est :
   ```bash
   git remote add origin https://github.com/<compte>/nez-de-quai.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment** : *Source* = **Deploy from a branch**, *Branch* = **main** / **(root)**, puis **Save**.
4. Après environ une minute, l'application est disponible à `https://<compte>.github.io/nez-de-quai/`.

**Mise à jour** : remplacer les fichiers dans le dépôt. Les appareils récupèrent la nouvelle version à la prochaine ouverture avec réseau.

## Développement et tests

```bash
npm install          # dépendances de test seulement (sql.js, jszip, xmldom)
# placer dans tests/data/ : 261009ADM2RC163_modif.txt, V1ADM.sie, V3ADM.sie,
#   ADM_NouvLR_Connect-Cite_Deviation_Comparison.xlsx (gabarit) et base.xlsx (format cumulatif)
npm test
npm run serve        # puis http://localhost:8080
```

Les tests vérifient :

- les calculs, par rapport aux résultats validés du levé 261009ADM2RC163 ;
- l'ajout dans l'Excel, à partir du gabarit et du format cumulatif ;
- le refus d'un doublon ;
- l'ajout d'un second levé.

Le dossier `tests/data` est exclu de git, afin de ne pas publier de données.

**Bibliothèques incluses (`vendor/`)** : [sql.js](https://github.com/sql-js/sql.js) 1.10.3 (MIT) et [JSZip](https://stuk.github.io/jszip/) 3.10.1 (MIT).
