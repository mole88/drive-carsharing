# Машины, дрон, купюры и Jägermeister

Созданы встроенным инструментом ImageGen с прозрачным фоном. Выбранные полные PNG сохранены в `app/static/images/sprites/<категория>/sources/`. Игровые PNG и WebP имеют одинаковые размеры, обрезаны по альфа-каналу и уменьшены для canvas; PNG — запасной формат при ошибке WebP. Никакие изображения не загружаются с внешних сайтов во время игры.

Модели: Kia Rio IV FB, Hyundai Solaris II HCr, Škoda Octavia III A7, BMW 320i G20; патруль — Octavia A7 ДПС. Дрон — стилизованный DJI Mavic 3 Enterprise. Купюры: 100, 200, 500, 1000, 2000 и 5000 рублей. Бутылка Jägermeister 0,7 л подготовлена как будущий предмет и пока не подключена к игровой механике.

Рендерер сохраняет номера аренды, наклон/вращение машин, нитро, щит, сирены ДПС, вращение винтов, подсветку камеры, прицел дрона и исчезновение объектов. Физика и экономика не меняются. Загружаются только выбранная машина и встреченные объекты.

Прототипы сверены с локальными фотографиями каталога и официальными материалами [DJI](https://enterprise.dji.com/mavic-3-enterprise/specs), [Банка России](https://www.cbr.ru/cash_circulation) и [Jägermeister](https://de.jagermeister.com/shop/jaegermeister/jaegermeister). Иллюстрации купюр упрощены для чтения в игре.

Для предпросмотра откройте `app/static/images/sprites/preview.html`: верхняя полоса показывает настоящие игровые размеры и эффекты, ниже — отдельные изображения. Общий лист — `objects-preview.png` в той же папке. Исходники оставлены в `sources/`, runtime-файлы: машины до 384×512, дрон 512×285, купюры шириной 384, бутылка 203×512. Всего 13 изображений; WebP для всех игровых объектов занимают около 600 КБ.

Проверка: `node --test tests/ui/game-art.test.cjs`; `node tests/ui/game-sprites.browser.cjs http://127.0.0.1:8011` — только на отдельной локальной базе, поскольку сценарий создаёт тестовую аренду. Проверяются загрузка, прозрачность, сохранение номеров и эффектов, PNG-резерв, отсутствие загрузки будущей бутылки в игре и отрисовка на компьютере и телефоне.

Референсы: Rio нарисован первым; Solaris, Octavia и первоначальный BMW используют Rio как образец камеры и стиля плюс соответствующую фотографию из `app/static/images/`. BMW дополнительно исправлен по фотографии настоящего G20; итог хранится как `vehicles/bmw`. Патруль использует стиль Rio и фотографию Octavia. Остальные изображения созданы по текстовому описанию.

## Полные промпты

### vehicles/rio

Файлы: `app/static/images/sprites/vehicles/rio.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG car sprite for a vertical Russian night driving arcade game, Night Shift. Primary request: realistic, recognizable white Kia Rio FOURTH GENERATION FB Russian sedan 2017-2020, compact four-door sedan, correct Kia Rio rear body shape and slender red tail lamps, small oval KIA badge on trunk, short sedan trunk, dark tinted glass. This is a Kia RIO, NOT an Optima, Ceed or SUV. Style: high quality hand-painted 3D game sprite, realistic automotive proportions and detailed materials but slightly caricatured, clean dark ink outline, crisp cel-shaded highlights, warm ivory white paint and subtle pink/cyan night reflections; readable at 110 pixels wide. Composition: single car exactly centered, bilateral symmetric straight-ahead orientation, longitudinal centerline perfectly vertical. Car drives toward TOP of image, rear bumper at BOTTOM, camera directly BEHIND car and elevated 65 degrees looking down from above; show roof, rear windshield, trunk and rear face; no lateral yaw, no diagonal angle, no perspective road. Full four wheels and both mirrors contained, generous transparent padding. Model occupies about 75% image height and 50% image width. Empty light license-plate rectangle, no plate digits (game overlays actual plate). Lighting from upper left, no cast shadow, no floor, NO pedestal, NO environment, NO checkerboard drawing, NO extra objects, NO particles, NO exhaust flame, NO text outside car. Genuine transparent alpha background. Output ONE isolated finished sprite, no sheet.
```

### vehicles/solaris

Файлы: `app/static/images/sprites/vehicles/solaris.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG car sprite for a vertical night driving arcade. Image 1 is a STYLE AND CAMERA REFERENCE ONLY: use its crisp painterly realism, dark ink outlines, restrained cel shading, subtle cyan/pink reflected highlights, elevated rear view and perfectly centered vertical alignment. Image 2 is a REAL MODEL IDENTITY reference: use the accurate car shape from it, NOT its side angle. Primary request: render the following car as a different model, recognizable and detailed, readable at 110 px wide. Camera directly behind and ABOVE at 65 degrees, car driving towards TOP, rear at BOTTOM, exact bilateral symmetry, zero yaw, not a diagonal three-quarter side view. Full object, wheels and mirrors contained with transparent padding. One single sprite. Real car proportions, no toy wheels, realistic windows and panel lines. Empty light rear license-plate rectangle for game text overlay. No shadows, no background, no floor, no pedestal, no checkerboard, no environment, no flames or particles, no captions. GENUINE transparent alpha.
Subject: Hyundai Solaris SECOND GENERATION HCr 2017-2019 Russian four-door compact sedan, sky blue paint, long sedan roofline, distinctive angular hook-shaped red rear tail lights wrapping into the trunk, correct Hyundai oval badge and SOLARIS rear model lettering. Not an Accent hatchback.
```

### vehicles/octavia

Файлы: `app/static/images/sprites/vehicles/octavia.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG car sprite for a vertical night driving arcade. Image 1 is a STYLE AND CAMERA REFERENCE ONLY: use its crisp painterly realism, dark ink outlines, restrained cel shading, subtle cyan/pink reflected highlights, elevated rear view and perfectly centered vertical alignment. Image 2 is a REAL MODEL IDENTITY reference: use the accurate car shape from it, NOT its side angle. Primary request: render the following car as a different model, recognizable and detailed, readable at 110 px wide. Camera directly behind and ABOVE at 65 degrees, car driving towards TOP, rear at BOTTOM, exact bilateral symmetry, zero yaw, not a diagonal three-quarter side view. Full object, wheels and mirrors contained with transparent padding. One single sprite. Real car proportions, no toy wheels, realistic windows and panel lines. Empty light rear license-plate rectangle for game text overlay. No shadows, no background, no floor, no pedestal, no checkerboard, no environment, no flames or particles, no captions. GENUINE transparent alpha.
Subject: Skoda Octavia THIRD GENERATION A7 2013-2016 five-door LIFTBACK, elegant emerald metallic green paint, longer car with sloping rear windshield and distinct squared C-shaped red taillights, broad tailgate and chrome Skoda round rear badge. Correct liftback roofline. NOT an estate/wagon, no roof rails.
```

### BMW — первоначальная генерация перед уточнением фонарей

Этот вариант не используется в игре. Затем применён промпт уточнения ниже; его результат сохранён как `vehicles/bmw`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG car sprite for a vertical night driving arcade. Image 1 is a STYLE AND CAMERA REFERENCE ONLY: use its crisp painterly realism, dark ink outlines, restrained cel shading, subtle cyan/pink reflected highlights, elevated rear view and perfectly centered vertical alignment. Image 2 is a REAL MODEL IDENTITY reference: use the accurate car shape from it, NOT its side angle. Primary request: render the following car as a different model, recognizable and detailed, readable at 110 px wide. Camera directly behind and ABOVE at 65 degrees, car driving towards TOP, rear at BOTTOM, exact bilateral symmetry, zero yaw, not a diagonal three-quarter side view. Full object, wheels and mirrors contained with transparent padding. One single sprite. Real car proportions, no toy wheels, realistic windows and panel lines. Empty light rear license-plate rectangle for game text overlay. No shadows, no background, no floor, no pedestal, no checkerboard, no environment, no flames or particles, no captions. GENUINE transparent alpha.
Subject: BMW 320i G20 2019-2022 sporty four-door sedan, metallic dark steel blue paint, correct long-hood/short-trunk silhouette and sharp L-shaped red LED rear lights, BMW circular rear badge, two small factory exhaust tips, tinted glass and subtle roof sunroof. Elegant production car, not a race car, no racing stripes, no oversized spoiler.
```

### vehicles/bmw

Файлы: `app/static/images/sprites/vehicles/bmw.{webp,png}`.

```text
Use case: precise-object-edit. Image 1 is the sprite to correct. Image 2 is the real BMW G20 model identity reference, not a camera reference. Correct Image 1 to more accurately depict BMW 320i G20 2019: its rear currently looks too much like a Kia Rio. Rebuild the rear body and tail lamps as a genuine BMW G20 rear: flatter wider premium sedan trunk, crisply squared rear haunches, narrow HORIZONTAL smoked-red LED taillight clusters with two elongated parallel L-shaped light signatures, horizontal slim inner lamps on trunk and short vertical outer return, no huge upward Kia-style triangular horns. Genuine circular BMW emblem and 320i badge, factory round exhaust tips. Long low German sedan stance. Keep the existing dark steel blue metallic finish, roof sunroof, painterly ink style and pink/cyan reflected highlights, elevated straight rear/top camera angle, exact vertical forward orientation, object position, scale, blank plate and genuine transparent alpha background. ONE car, no floor or environment, no cast shadow, no captions.
```

### vehicles/police

Файлы: `app/static/images/sprites/vehicles/police.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG enemy police car sprite for vertical Russian night-driving arcade. Image1 is style reference ONLY, Image2 is real Skoda Octavia A7 model reference. Paint a REALISTIC Skoda Octavia A7 2013-2016 Russian DPS patrol liftback, white body, authentic cobalt-blue police strips on sides and a broad blue hood stripe, restrained red-blue lightbar on ROOF, recognizable Skoda vertical-slat grille, angular rectangular headlights, correct full wheels and wing mirrors. ONE CAR. Camera directly ABOVE AND IN FRONT of the car at 65 degrees, centered zero yaw. IMPORTANT: FRONT BUMPER AND GRILLE FACE BOTTOM of image, rear points TOP; player car reference faces opposite way, do NOT copy its rear-view orientation. Show hood, windshield, roof, roof lightbar, front headlights/grille. Whole car fits within frame with padding. Style: polished hand-painted semi-realistic arcade asset, fine dark ink contours, believable automotive proportions, clean cel shaded materials, warm/cyan faint reflections consistent with reference. Blank license plate; exact small hood lettering 'ДПС', no other labels. Static lightbar lenses with no big light flares; animation is added in game. GENUINE transparent alpha, no floor, no shadow, no road, no checkerboard, no scenery, no captions.
```

### drones/mavic

Файлы: `app/static/images/sprites/drones/mavic.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG animated-game base sprite. Draw a recognizably real DJI MAVIC 3 ENTERPRISE folding QUADCOPTER, all FOUR arms extended in an X, four separate wide two-bladed propellers at arm tips, compact matte warm-gray aerodynamic central body, vents, joints, small navigation lamps, front dual camera and stabilized gimbal visible under the nose. No weapon or attachments. High elevated frontal/top view, symmetrical straight alignment, front camera/nose points BOTTOM, camera looking down from above at 60 degrees. Show full aircraft including ALL four propeller discs with plenty of transparent padding; width larger than height, compact readable silhouette. Small propeller blur discs, NOT huge swooshes or glow clouds. Style: polished hand-painted 3D game sprite, semi-realistic mechanical forms, crisp dark ink outline, bold cel-shaded materials, restrained cyan/pink reflected highlights for a satirical neon night arcade, readable at 140 pixels wide. Real drone proportions, not a toy or cartoon face, no helicopter, no airplane. GENUINE transparent alpha background; no floor, no environment, no shadows, no labels or watermark. ONE isolated drone only.
```

### items/jagermeister

Файлы: `app/static/images/sprites/items/jagermeister.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG inventory/pickup item sprite for a semi-realistic Russian neon night arcade, reserved for future game use. Draw the iconic JÄGERMEISTER ORIGINAL 0.7-liter bottle: dark forest-green rectangular glass body with rounded shoulders, short narrow green neck and dark green screw cap, subtly translucent glass catching cyan and warm pink edge highlights; orange and cream rectangular paper label with the unmistakable stag-head/cross round emblem, ornamental borders and black blackletter brand text exactly 'Jägermeister'. Small orange neck ribbon. Correct iconic real bottle shape, sealed full intact bottle, believable glass thickness and rich herbal-liqueur appearance. Style: polished hand-painted game illustration, realistic product detail but crisp dark ink outlines and bold readable simplified forms, mildly caricatured, matching detailed painted cars and adult nightlife sprites. Straight upright front view with only a subtle elevated angle, label faces camera, centered full bottle including cap and bottom, tall isolated silhouette with padding, readable at 60 px tall. One bottle only, no glasses, no ice, no hands, no scene, no floor or cast shadow, no extra objects, no background glow, no watermark or caption. GENUINE transparent alpha background.
```

### cash/rub-100

Файлы: `app/static/images/sprites/cash/rub-100.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 100-ruble classic Russian note, denomination text EXACTLY '100'. Beige ochre and warm brown engraving palette, Bolshoi Theatre facade and the Apollo horse quadriga motif, pale right-side watermark area. Large 100 twice. NOT 1000.
```

### cash/rub-200

Файлы: `app/static/images/sprites/cash/rub-200.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 200-ruble Russian note, denomination EXACTLY '200'. Fresh emerald and mint-green engraving palette, monument to sunken ships with tall column in Sevastopol, sea and distant harbor, pale right watermark area. Large 200 twice. NOT 2000.
```

### cash/rub-500

Файлы: `app/static/images/sprites/cash/rub-500.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 500-ruble classic Russian note, denomination EXACTLY '500'. Mauve lavender purple engraving palette, statue of Peter the Great in Arkhangelsk, sailing ship and harbor motif, pale right watermark area. Large 500 twice. NOT 5000.
```

### cash/rub-1000

Файлы: `app/static/images/sprites/cash/rub-1000.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 1000-ruble classic Russian note, denomination EXACTLY '1000'. Turquoise sea-green and teal engraving palette, Yaroslav the Wise monument and Yaroslavl historic chapel/architecture, pale right watermark area. Large 1000 twice.
```

### cash/rub-2000

Файлы: `app/static/images/sprites/cash/rub-2000.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 2000-ruble Russian note, denomination EXACTLY '2000'. Cool sapphire blue and pale cyan engraving palette, striking cable-stayed Russky Bridge in Vladivostok spanning water, pale right watermark area. Large 2000 twice. NOT 200.
```

### cash/rub-5000

Файлы: `app/static/images/sprites/cash/rub-5000.{webp,png}`.

```text
Use case: stylized-concept. Asset type: ONE transparent PNG Russian ruble banknote pickup sprite for a semi-realistic neon night arcade. Primary request: redraw ONE recognizable real Russian banknote as a stylized hand-painted game object. Composition: single horizontal rectangular note, landscape canvas, front face facing viewer, very slight perspective depth, near-flat face so denomination stays legible, a subtle curled upper-right paper corner and gently worn edges, full note centered with transparent padding. Paper width-to-height about 2.3:1. Style: realistic currency illustration details simplified into clean engraved linework, paper texture and crisp dark ink contour; restrained cel shading consistent with realistic painted game cars; believable folded paper highlights, no thick comic currency symbol. At small size it must read as a Russian BANKNOTE, not a green dollar or coupon. Large perfectly legible exact denomination in lower-right and upper-left corners, both using the same digits; denomination is the main readable feature at 80 px wide. Small 'БИЛЕТ БАНКА РОССИИ' across top, ornamental printed patterns, do not invent foreign currency. No shadows, no floor, no glow cloud, no background, no grid, no checkerboard, no other objects, no watermark, no captions outside banknote. GENUINE transparent alpha background. Output ONE banknote, no sheet or montage.
Subject: a 5000-ruble classic Russian note, denomination EXACTLY '5000'. Brick-red terracotta, warm coral and burnt-orange engraving palette, statue of Muravyov-Amursky in Khabarovsk on tall pedestal, trees and Amur riverbank architectural motif, pale right watermark area. Large 5000 twice. NOT 500.
```
