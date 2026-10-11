# Спрайты персонажей: гламур нулевых

Четыре оригинальных PNG 1024 × 1536 с прозрачным альфа-каналом, созданные встроенным инструментом `image_gen`. Полуреалистичная карикатура: взрослые персонажи, выразительные лица, яркий макияж, объёмные волосы, стразы, мех и платформы. Для каждого персонажа добавлен цикл ходьбы; публикация и развёртывание не выполнялись.

| Файл | Образ |
| --- | --- |
| `blonde-pink.png` | Блондинка, розовое платье, голубые тени, белые сапоги |
| `brunette-leopard.png` | Брюнетка, леопардовое платье, мех, фиолетовые тени |
| `redhead-turquoise.png` | Рыжая, бирюзовая куртка, деним, серебряные аксессуары |
| `vip-gold.png` | VIP, золотое платье и сапоги, белый мех, высокая причёска |

`game-art.js` загружает изображения относительно своего URL и передаёт им версию из параметров скрипта. Для обычных персонажей образ выбирается по существующему `hue` (три диапазона по 120°), VIP получает золотой спрайт. Масштаб, вращение и прозрачность полёта, тень, портфель, VIP-звезда и реакция `?!` сохраняются. Ядро, коллизии и баланс не менялись.

## Анимация ходьбы

| Игровой атлас | Исходник imagegen | Кадры |
| --- | --- | --- |
| `blonde-pink-walk.webp` | `blonde-pink-walk.png` | 8 |
| `brunette-leopard-walk.webp` | `brunette-leopard-walk.png` | 8 |
| `redhead-turquoise-walk.webp` | `redhead-turquoise-walk.png` | 8 |
| `vip-gold-walk.webp` | `vip-gold-walk.png` | 8 |

Каждый исходный PNG — 1448 × 1086, сетка 4 × 2, ячейка 362 × 543. WebP-версии — 1024 × 768, ячейка 256 × 384, с сохранённой прозрачностью. Четыре игровых файла занимают около 1.25 МБ вместо 7.15 МБ исходников. WebP подготовлен механическим уменьшением и сжатием PNG; рисунки и позы созданы встроенным `image_gen`.

Порядок кадров: контакт → перенос веса → проход ноги → вынос ноги → второй контакт → перенос веса → проход ноги → вынос ноги. Кадр выбирается по `stride` из игрового ядра, поэтому темп зависит от скорости, пауза игры останавливает цикл, а разные персонажи не шагают синхронно. В полёте и при нулевой скорости используется контактный кадр. При движении влево персонаж зеркалится. Центр головы и линия опоры выровнены для каждого кадра; дополнительное покачивание всего спрайта для атласов отключено.

Изначально загружаются только четыре WebP. Пока они загружаются, работает процедурный запасной рисунок; при ошибке атласа подгружается соответствующий исходный статичный PNG. Лишние большие портреты не скачиваются при успешной загрузке анимации.

[Интерактивный локальный просмотр](../../../../../docs/nightlife-walk-preview.html) · [GIF-превью](../../../../../docs/nightlife-walk-preview.gif) · [Промпты ходьбы](walk-prompts.md).

## Промпты генерации

Для остальных образов первый PNG использован только как стилистический референс. Для каждого вызова установлено `transparent_background: true`.

### Блондинка

```text
Use case: stylized-concept
Asset type: transparent full-body character sprite for a satirical 2D night-driving arcade game.
Primary request: redraw an adult female street-nightlife character as a more realistic but expressive caricature in flashy early-2000s glamour fashion with very bright makeup.
Subject: one clearly adult woman aged about 30, voluminous peroxide-blonde layered hair with dark roots, oversized gold hoop earrings, exaggerated self-assured raised eyebrow, prominent glossy hot-pink lips, strong cobalt eyeshadow, thick black eyeliner, long eyelashes and bronzer. Fitted shiny hot-pink halter mini dress, wide rhinestone belt, small matching shoulder handbag, tall white platform-heeled boots. Fully clothed fashion illustration, no nudity.
Style/medium: polished hand-painted semi-realistic game character with caricatured face, subtly enlarged head (roughly 5.5 heads tall), believable adult anatomy, real shading of skin, fabric, hair and glossy accessories; crisp dark plum contour and bold readable shapes. Cheeky satirical early-2000s glamour, not cute, not chibi, not pixel art, not a photograph, not anime.
Composition/framing: a single isolated full-length standing / mid-step sprite facing almost forward with a slight three-quarter angle to viewer's right; weight on one leg, one hand on hip, handbag on opposite shoulder; all hair, fingers, handbag and both boots fully inside frame. Portrait canvas, character fills about 90% of height, balanced central placement with narrow transparent margins. Arms close to body for compact game silhouette.
Lighting: neutral soft studio shading with subtle warm highlights, readable against a dark game road.
Constraints: genuinely transparent alpha background; no scenery, no ground plane, no cast shadow, no text, no watermark, no grid, no duplicate characters. Keep face and strong makeup highly readable at small sprite size.
```

### Брюнетка

```text
Use case: stylized-concept
Asset type: transparent full-body adult character sprite, one of a consistent set for a satirical 2D night-driving arcade.
Input images: Image 1 is ONLY a reference for painting style, adult body proportions, caricatured makeup and crisp plum contours, not an edit target. Create a different adult character.
Primary request: one clearly adult brunette woman, aged about 35, in exaggerated early-2000s nightlife glamour. Long voluminous jet-black hair with a high half-up ponytail, gold hoop earrings, angular amused face and a knowingly unimpressed expression, glossy cherry-red lipstick, strong violet eyeshadow and dramatic eyeliner, exaggerated eyelashes and cheekbones. Fitted leopard-print mini dress, cropped faux-fur bolero resting on shoulders, wide black belt with a rhinestone buckle, small black patent handbag, tall black platform boots.
Style: same hand-painted semi-realistic fashion caricature as the style reference: realistic skin, hair and fabric shading, slightly enlarged expressive adult face, roughly 5.5 heads tall, bold compact silhouette and clean dark-plum outlines, highly readable at small game scale. More cartoon exaggeration in face, no chibi, no anime, no pixel art, no photography.
Composition: exactly ONE full-body isolated sprite, near-front three-quarter view to viewer's right, confident mid-step with one hand on hip and bag close to the body; full hair, fingertips and boot soles visible, about 90% of a portrait canvas height, central placement, narrow margins.
Backdrop: completely transparent alpha, only the character and accessories. Remove every background pixel including any colored haze or vignette. No ground, no cast shadow, no glow behind the subject.
Constraints: fully clothed adult fashion character; no nudity; no text, logos, watermark, scenery, frames, grids or other people.
```

### Рыжая

```text
Use case: stylized-concept
Asset type: one transparent full-body character sprite in a consistent semi-realistic caricature set for a satirical night-driving game.
Input images: Image 1 is ONLY a style reference for hand-painted rendering, clean dark plum contours and bright early-2000s glamour; make a new distinct character.
Subject: one clearly adult woman aged about 32 with copper-red teased shoulder-length curls and a side-swept fringe, expressive slightly broad adult face, arched eyebrow, smirking vivid coral-gloss lips, intensely turquoise eyeshadow, heavily winged black eyeliner, blush and long lashes. Large silver hoop earrings, flashy cropped turquoise faux-leather jacket over a silver camisole, dark low-rise denim mini skirt with wide silver rhinestone belt, silver platform-heeled knee-high boots, a tiny metallic silver handbag held at her side. All clothing opaque and covering the body.
Style: polished semi-realistic hand-painted fashion caricature, slightly oversized head and expressive mouth/eyes, roughly 5.5 heads tall, convincing adult anatomy, hair strands, natural skin shading and glossy textile detail, bold readable silhouette, not cute or chibi, no anime or pixel art.
Composition: ONLY one full-length sprite centered in portrait framing, mostly front view at a subtle three-quarter angle to viewer's right; casual walking stance with separated feet rather than crossed legs, one hand at belt, other holding bag close to hip. Whole hair and footwear fully visible with narrow transparent margins, fills about 90% of height.
Backdrop: genuine empty transparent alpha background; no painted backdrop, NO haze, NO vignette, NO ground shadow, NO ambient glow outside silhouette.
Constraints: fully clothed adult; no nudity, no text, logos, watermarks, scene, grid or additional characters. Maintain style consistency with reference but change the face, hair, outfit and pose.
```

### VIP

```text
Use case: stylized-concept
Asset type: transparent full-body VIP character sprite for a satirical 2D night-driving arcade; part of a consistent early-2000s glamour set.
Input images: Image 1 is ONLY a painting-style and silhouette reference, not an edit target; create a distinct character and outfit.
Subject: one clearly adult VIP woman aged about 38 with an elaborate chestnut-brown high updo and face-framing curled strands. Visibly caricatured expressive face with arched brows, exaggerated glossy burgundy-pink lips, strong gold-and-purple smoky eyeshadow, heavy eyeliner, long eyelashes and bronzed skin. Gold hoop earrings, large gold necklace, gold bangles. Glamorous metallic-gold sleeveless mini dress with opaque fabric and a rhinestone waistband, white faux-fur stole draped around elbows, small gold handbag, gold platform-heeled boots. Confident slightly haughty playful expression, hand on hip.
Style: same polished hand-painted semi-realistic caricature as the reference, convincing grown-up anatomy, expressive slightly oversized head (about 5.5 heads tall), detailed skin/fabric/hair shading, bold compact silhouette, crisp dark-plum contours. Clear, memorable face and bright makeup, no chibi, anime, pixel art or photography.
Composition: ONLY ONE isolated full-body sprite, almost front-facing three-quarter view toward viewer's right. Upright pose with one foot stepping to the side, all hair, fingers, bag and boot soles visible, centered in portrait canvas, fills about 90% of canvas height and narrow transparent margins.
Backdrop: genuine transparent alpha background. No scene, no ground, no cast shadow, no haze, no vignette, no glow outside the silhouette.
Constraints: fully clothed adult nightlife fashion illustration, no nudity. No crown or floating star (game draws its own VIP marker). No text, logos, watermark, frames, grid or additional characters.
```
