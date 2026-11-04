# Haras

Généalogie des **dragodindes, muldos et volkornes** (306 montures, G1 à G10).

## Lancer

```bash
python3 server.py            # http://127.0.0.1:8765/  (option : --host 0.0.0.0, ou PORT=...)
```

Python 3 seul, aucune dépendance. `server.py` sert les fichiers et une petite API JSON ; les comptes et les
montures possédées sont dans `haras.db` (SQLite, ignoré par git, emplacement réglable avec `HARAS_DB`).

- **Compte** : l'écran de connexion liste les comptes existants (on clique sur son profil) et permet d'en créer
  un avec un simple pseudo, sans mot de passe. « Se souvenir de moi » garde la session 90 jours ; sinon elle
  s'arrête à la fermeture de l'onglet. La liste des pseudos est visible de tous et n'importe qui peut ouvrir
  n'importe quel compte : à réserver à un usage entre amis ou en local.
- Les montures possédées sont enregistrées sur le serveur. À la création du compte, celles déjà cochées en
  local sont reprises. Sans serveur (ouverture de `index.html` en `file://`), l'app reste utilisable en mode
  local : tout est alors dans le `localStorage`.
- Le sens de lecture et le thème (Auto / Clair / Sombre) se règlent dans la popup du bouton engrenage ⚙.
- `data.js` : les montures (nom, génération, recettes). Les recettes viennent de DofusElevage ; plusieurs
  montures ont plusieurs recettes (jusqu'à 12), à choisir dans la fiche, via le bouton ↻ de l'arbre ou dans
  la liste de courses.
- `images/<famille>/` : rendus des montures de l'API publique DofusDude (Ankama), PNG 128 px à fond transparent.
- Les préférences d'affichage (sélection, vue, zoom, recettes choisies) restent dans le `localStorage`.
  Exporter / Importer permet de transférer les montures possédées.

## Liste de courses

L'onglet « Liste de courses » calcule, pour la monture sélectionnée et une quantité donnée, les G1 à
capturer et les accouplements à faire génération par génération. Hypothèse : un accouplement consomme
un exemplaire de chaque parent et donne un bébé de la monture visée ; une monture cochée « possédée »
compte pour un exemplaire. Les étapes cochées sont mémorisées par objectif.

## Mobile

Sous 760 px de large, la liste des montures devient un tiroir (bouton « ☰ Montures »), l'en-tête est
compacté et les onglets sont raccourcis. Dans l'arbre et la vue d'ensemble : glisser pour se déplacer,
pincer à deux doigts pour zoomer.

## Design

L'interface utilise le design system **Brume** : `brume.css` contient les tokens (thèmes clair et sombre) et
les classes de composants, `style.css` ne contient que les styles propres à l'application et n'utilise aucune
couleur en dur. Police Nunito chargée depuis Google Fonts (repli sur Helvetica Neue hors ligne).

## Icône

`icon.svg` (tête de dragodinde de face, style Material : aplats et tons superposés) s'adapte au thème du
navigateur ; dans l'en-tête, la même icône est inlinée et suit le bouton clair/sombre de l'application.
`icon-32.png` et `apple-touch-icon.png` sont les versions PNG de secours (favicon et écran d'accueil iOS).
