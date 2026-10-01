# Généalogie des Dragodindes

Double-cliquez sur `index.html` : aucune installation, aucun serveur, tout fonctionne hors ligne.

- `data.js` : les 66 dragodindes (nom, génération, Parent 1 / Parent 2), extraites de
  https://dofuselevage.fr/tools/reproduction/dragodinde/genealogie
- `images/` : les images des montures, téléchargées depuis DofusElevage
- Les montures cochées « possédées », la sélection, la vue et le zoom sont sauvegardés dans le
  `localStorage` du navigateur. Utilisez Exporter / Importer pour les transférer.

## Liste de courses

L'onglet « Liste de courses » calcule, pour la monture sélectionnée et une quantité donnée, les G1 à
capturer et les accouplements à faire génération par génération. Hypothèse : un accouplement consomme
un exemplaire de chaque parent et donne un bébé de la monture visée ; une monture cochée « possédée »
compte pour un exemplaire. Les étapes cochées sont mémorisées par objectif.

## Mobile

Sous 760 px de large, la liste des montures devient un tiroir (bouton « ☰ Montures »), l'en-tête est
compacté et les onglets sont raccourcis. Dans l'arbre et la vue d'ensemble : glisser pour se déplacer,
pincer à deux doigts pour zoomer.
