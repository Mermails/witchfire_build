# Formules élémentaires relevées

Relevé des captures du fil ChatGPT, pas une mesure en jeu.
Les formules utilisent les cellules ci-dessous. Le tableau de résultats suppose les valeurs par défaut.

## Entrées

| Cellule | Rôle | Défaut de l'exemple |
| --- | --- | --- |
| B2 | Dégâts du tir | 100 |
| B3 | Magnitude de brûlure | 25 % soit 0,25 |
| B4 | Magnitude de choc | 30 % soit 0,30 |
| B5 | Dégâts d'un tick de putréfaction | 15 |
| B6 | Cible gelée, 0 ou 1 | non branchée dans les formules affichées |

Le gel est écrit en dur comme un multiplicateur 1,5. Aucune formule affichée ne lit B6.

Magnitude de brûlure standard : 1,25, soit `1 + B3`.

## Formules

Brûlure seule. Le wiki la donne comme une hausse des dégâts reçus, +25 % de base.

```
=B2*(1+B3)
```

Gel seul. Un ennemi gelé subit 50 % de dégâts en plus.

```
=B2*1.5
```

Brûlure + gel. L'explosion propre à ce couple existe, mais sa formule n'est pas documentée. Seul le bonus garanti est calculé.

```
=B2*(1+B3)*1.5
```

Brûlure + putréfaction. Le wiki documente cette formule. Le tick est multiplié par la magnitude de brûlure, puis par 1,5.

```
=B5*(1+B3)*1.5
```

Choc seul. Le second rebond vaut la moitié du premier.

```
=B2*B4
=B2*B4*0.5
```

Brûlure + choc, dégâts de chaîne sur le premier rebond.

```
tir × magnitude de choc × 2,1 × magnitude de brûlure
=B2*B4*2.1*(1+B3)
```

Triple brûlure + putréfaction + choc. Le wiki indique trois choses : la brûlure augmente les ticks de putréfaction, chaque tick de putréfaction déclenche le choc, et le choc hérite de la puissance déjà obtenue.

```
tick amélioré     =B5*(1+B3)*1.5
éclair du tick    =(B5*(1+B3)*1.5)*B4
éclair secondaire =((B5*(1+B3)*1.5)*B4)*0.5
```

## Résultats affichés

Avec le tir à 100, la brûlure à 25 %, le choc à 30 % et le tick de putréfaction à 15.

| Effet | Valeur affichée | Calcul exact |
| --- | ---: | --- |
| Tir normal | 100 | 100 |
| Brûlure | 125 | 100 × 1,25 = 125 |
| Gel | 150 | 100 × 1,5 = 150 |
| Brûlure + gel | 187,5 | 100 × 1,25 × 1,5 = 187,5 |
| Tick brûlure + putréfaction | 28,1 | 15 × 1,25 × 1,5 = 28,125 |
| Choc, rebond 1 | 30 | 100 × 0,30 = 30 |
| Choc, rebond 2 | 15 | 100 × 0,30 × 0,5 = 15 |
| Brûlure + choc, rebond 1 | 78,8 | 100 × 0,30 × 2,1 × 1,25 = 78,75 |
| Brûlure + putréfaction + choc, rebond 1 | 8,4 | 28,125 × 0,30 = 8,4375 |

L'éclair secondaire du triple combo n'est pas dans le tableau. La formule donne 8,4375 × 0,5 = 4,21875.

## Exemples cités à part

- Brûlure : tir 100, brûlure 25 %, résultat 125.
- Brûlure + gel : 100 × 1,25 × 1,5 = 187,5.
- Brûlure + putréfaction : 15 × 1,25 × 1,5 = 28,125.
- Brûlure + choc : 100 dégâts, 30 % de choc, 25 % de brûlure, soit 100 × 0,30 × 2,1 × 1,25 = 78,75 sur le premier rebond.
