# Промпты циклов ходьбы

Создано встроенным `image_gen`, для всех четырёх вызовов `transparent_background: true`. Первая входная картинка — [схема восьми фаз шага](walk-pose-guide.png), вторая — соответствующий исходный портрет из этой папки. Одинаковая схема задаёт сетку 4 × 2 и порядок фаз. Выбраны следующие исходные атласы; рабочие WebP уменьшены и сжаты с сохранением альфа-канала.

## Блондинка

Входной персонаж: `blonde-pink.png`. Результат: `blonde-pink-walk.png`, игровой атлас: `blonde-pink-walk.webp`.

```text
EDIT IMAGE 1 into a production eight-frame walk-cycle sprite sheet. Image 1 is the EXACT grid and walking-pose target. Image 2 supplies adult character identity, costume and painted style. Replace each guide skeleton with the SAME adult woman from Image 2, preserving each skeleton's hip, knee and ankle positions. Use: voluminous blonde hair with dark roots, cobalt blue eye makeup, glossy pink lips, gold hoops, shiny pink halter minidress, rhinestone belt, pink shoulder handbag and white platform boots. Keep face, clothing, colors, proportions and accessories identical across frames.
Exactly FOUR equal columns and TWO equal rows, chronological cells 1–8. Eight full-body sprites, same size, same pelvis center and contact baseline at 92% of each cell height. Canvas 2048x1536 preferred.
CRITICAL: follow all eight distinct leg poses in Image 1. Red guide limb = the NEAR leg; blue = FAR. In frame 1 near leg goes right and far left. In frame 5 near leg goes left and far right: opposite leg now leads, with swapped leg occlusion. Frame 3 and 7 are passing poses: one planted vertical leg, other bent forward. Frame 2,4,6,8 have a lifted foot and bent knee. Arms naturally swing opposite legs, bag sways slightly, no frozen hand-on-hip pose or repeated crossed-leg fashion pose. Near-side profile / right three-quarter walk toward screen-right, showing face makeup.
Semi-realistic hand-painted early-2000s glamour caricature matching Image 2: believable adult anatomy, expressive face, crisp dark outlines and saturated colors. The eight poses form a complete smooth repeatable gait.
Remove ALL diagram text, red/blue guide colors, lines, grids and backdrop. Outside character silhouettes must be genuinely transparent alpha including holes between legs and arms. No ground, shadow, haze, watermark, letters, decorations, extra limbs, missing legs or overlapping neighboring cells. Fully clothed adult.
```

## Брюнетка

Входной персонаж: `brunette-leopard.png`. Результат: `brunette-leopard-walk.png`, игровой атлас: `brunette-leopard-walk.webp`.

```text
EDIT IMAGE 1 into a production eight-frame walk-cycle sprite sheet. Image 1 is the EXACT grid and walking-pose target. Image 2 supplies adult character identity, costume and painted style. Replace each guide skeleton with the SAME adult woman from Image 2, preserving each skeleton's hip, knee and ankle positions. Use: black voluminous hair, violet eye makeup, red glossy lips, gold hoops, leopard-print dress, rhinestone belt, pale fur bolero, black handbag and black platform boots. Keep face, clothing, colors, proportions and accessories identical across frames.
Exactly FOUR equal columns and TWO equal rows, chronological cells 1–8. Eight full-body sprites, same size, same pelvis center and contact baseline at 92% of each cell height. Canvas 2048x1536 preferred.
CRITICAL: follow all eight distinct leg poses in Image 1. Red guide limb = the NEAR leg; blue = FAR. In frame 1 near leg goes right and far left. In frame 5 near leg goes left and far right: opposite leg now leads, with swapped leg occlusion. Frame 3 and 7 are passing poses: one planted vertical leg, other bent forward. Frame 2,4,6,8 have a lifted foot and bent knee. Arms naturally swing opposite legs, bag sways slightly, no frozen hand-on-hip pose or repeated crossed-leg fashion pose. Near-side profile / right three-quarter walk toward screen-right, showing face makeup.
Semi-realistic hand-painted early-2000s glamour caricature matching Image 2: believable adult anatomy, expressive face, crisp dark outlines and saturated colors. The eight poses form a complete smooth repeatable gait.
Remove ALL diagram text, red/blue guide colors, lines, grids and backdrop. Outside character silhouettes must be genuinely transparent alpha including holes between legs and arms. No ground, shadow, haze, watermark, letters, decorations, extra limbs, missing legs or overlapping neighboring cells. Fully clothed adult.
```

## Рыжая

Входной персонаж: `redhead-turquoise.png`. Результат: `redhead-turquoise-walk.png`, игровой атлас: `redhead-turquoise-walk.webp`.

```text
EDIT IMAGE 1 into a production eight-frame walk-cycle sprite sheet. Image 1 is the EXACT grid and walking-pose target. Image 2 supplies adult character identity, costume and painted style. Replace each guide skeleton with the SAME adult woman from Image 2, preserving each skeleton's hip, knee and ankle positions. Use: copper-red hair, bright turquoise eye makeup, coral glossy lips, silver hoops, turquoise jacket, silver camisole, denim miniskirt, rhinestone belt, silver handbag and silver platform boots. Keep face, clothing, colors, proportions and accessories identical across frames.
Exactly FOUR equal columns and TWO equal rows, chronological cells 1–8. Eight full-body sprites, same size, same pelvis center and contact baseline at 92% of each cell height. Canvas 2048x1536 preferred.
CRITICAL: follow all eight distinct leg poses in Image 1. Red guide limb = the NEAR leg; blue = FAR. In frame 1 near leg goes right and far left. In frame 5 near leg goes left and far right: opposite leg now leads, with swapped leg occlusion. Frame 3 and 7 are passing poses: one planted vertical leg, other bent forward. Frame 2,4,6,8 have a lifted foot and bent knee. Arms naturally swing opposite legs, bag sways slightly, no frozen hand-on-hip pose or repeated crossed-leg fashion pose. Near-side profile / right three-quarter walk toward screen-right, showing face makeup.
Semi-realistic hand-painted early-2000s glamour caricature matching Image 2: believable adult anatomy, expressive face, crisp dark outlines and saturated colors. The eight poses form a complete smooth repeatable gait.
Remove ALL diagram text, red/blue guide colors, lines, grids and backdrop. Outside character silhouettes must be genuinely transparent alpha including holes between legs and arms. No ground, shadow, haze, watermark, letters, decorations, extra limbs, missing legs or overlapping neighboring cells. Fully clothed adult.
```

## VIP

Входной персонаж: `vip-gold.png`. Результат: `vip-gold-walk.png`, игровой атлас: `vip-gold-walk.webp`.

```text
EDIT IMAGE 1 into a production eight-frame walk-cycle sprite sheet. Image 1 is the EXACT grid and walking-pose target. Image 2 supplies adult character identity, costume and painted style. Replace each guide skeleton with the SAME adult woman from Image 2, preserving each skeleton's hip, knee and ankle positions. Use: chestnut high updo, gold-and-purple makeup, vivid glossy pink lips, gold jewelry, metallic-gold dress with rhinestone belt, pale fur stole, gold handbag and gold platform boots. Keep face, clothing, colors, proportions and accessories identical across frames.
Exactly FOUR equal columns and TWO equal rows, chronological cells 1–8. Eight full-body sprites, same size, same pelvis center and contact baseline at 92% of each cell height. Canvas 2048x1536 preferred.
CRITICAL: follow all eight distinct leg poses in Image 1. Red guide limb = the NEAR leg; blue = FAR. In frame 1 near leg goes right and far left. In frame 5 near leg goes left and far right: opposite leg now leads, with swapped leg occlusion. Frame 3 and 7 are passing poses: one planted vertical leg, other bent forward. Frame 2,4,6,8 have a lifted foot and bent knee. Arms naturally swing opposite legs, bag sways slightly, no frozen hand-on-hip pose or repeated crossed-leg fashion pose. Near-side profile / right three-quarter walk toward screen-right, showing face makeup.
Semi-realistic hand-painted early-2000s glamour caricature matching Image 2: believable adult anatomy, expressive face, crisp dark outlines and saturated colors. The eight poses form a complete smooth repeatable gait.
Remove ALL diagram text, red/blue guide colors, lines, grids and backdrop. Outside character silhouettes must be genuinely transparent alpha including holes between legs and arms. No ground, shadow, haze, watermark, letters, decorations, extra limbs, missing legs or overlapping neighboring cells. Fully clothed adult.
```
