-- More sample listings, so each category has plenty to browse: 15 draws and 10
-- fixed-price products each. The same items as src/api/seedCatalog.ts.
-- seed_demo_data keeps doing what it did, then adds these if it added the rest,
-- so a database with real listings never gets sample ones.
alter function private.seed_demo_data() rename to seed_core_listings;

create function private.seed_catalog() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select * from (values
      ('11111111-1111-4111-8111-000000000001'::uuid, 'iPhone 16 Pro, 256GB', 'Phones', array['/assets/iphone-16-pro-256gb.jpg'], 'Brand new and sealed, with a one-year store warranty.', 1950000::bigint, 5000::bigint, 84, interval '70 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'iPhone 15, 128GB', 'Phones', array['/assets/iphone-15-128gb.jpg'], 'Brand new and sealed, any colour in stock.', 1250000::bigint, 5000::bigint, 42, interval '110 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'iPhone 14, 128GB', 'Phones', array['/assets/iphone-14-128gb.jpg'], 'UK-used, battery health 90% or better, three-month warranty.', 780000::bigint, 4000::bigint, 48, interval '44 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Samsung Galaxy Z Fold6, 256GB', 'Phones', array['/assets/samsung-galaxy-z-fold6-256gb.jpg'], 'Brand new foldable with case and local warranty.', 2350000::bigint, 10000::bigint, 28, interval '160 hours', 'convert_to_sale', 2350000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Samsung Galaxy Z Flip6, 256GB', 'Phones', array['/assets/samsung-galaxy-z-flip6-256gb.jpg'], 'Brand new and sealed, with a clear case.', 1400000::bigint, 5000::bigint, 50, interval '96 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung Galaxy A55, 256GB', 'Phones', array['/assets/samsung-galaxy-a55-256gb.jpg'], 'Brand new, dual SIM, with local warranty.', 620000::bigint, 2000::bigint, 71, interval '52 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Samsung Galaxy S24 FE, 256GB', 'Phones', array['/assets/samsung-galaxy-s24-fe-256gb.jpg'], 'Brand new and sealed, with charger.', 950000::bigint, 4000::bigint, 34, interval '130 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Xiaomi 14, 512GB', 'Phones', array['/assets/xiaomi-14-512gb.jpg'], 'Brand new, Leica cameras, with a one-year warranty.', 1150000::bigint, 5000::bigint, 24, interval '180 hours', 'convert_to_sale', 1150000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Redmi Note 13 Pro, 256GB', 'Phones', array['/assets/redmi-note-13-pro-256gb.jpg'], 'Brand new, dual SIM, 200MP camera.', 420000::bigint, 2000::bigint, 56, interval '36 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Tecno Camon 30 Premier', 'Phones', array['/assets/tecno-camon-30-premier.jpg'], 'Brand new with fast charger and local warranty.', 520000::bigint, 2000::bigint, 52, interval '84 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Infinix Note 40 Pro', 'Phones', array['/assets/infinix-note-40-pro.jpg'], 'Brand new with magnetic charger and local warranty.', 410000::bigint, 2000::bigint, 49, interval '60 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Google Pixel 9, 256GB', 'Phones', array['/assets/google-pixel-9-256gb.jpg'], 'Brand new, unlocked, with a one-year warranty.', 1050000::bigint, 5000::bigint, 19, interval '200 hours', 'convert_to_sale', 1050000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'OnePlus 12, 256GB', 'Phones', array['/assets/oneplus-12-256gb.jpg'], 'Brand new, unlocked, with 100W charger.', 1150000::bigint, 5000::bigint, 30, interval '150 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Nothing Phone (2a), 256GB', 'Phones', array['/assets/nothing-phone-2a-256gb.jpg'], 'Brand new and sealed, with local warranty.', 560000::bigint, 2000::bigint, 53, interval '90 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Huawei Pura 70 Pro', 'Phones', array['/assets/huawei-pura-70-pro.jpg'], 'Brand new and sealed, with charger.', 1300000::bigint, 5000::bigint, 20, interval '220 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Canon EOS R6 camera + 24-105mm lens', 'Electronics', array['/assets/canon-eos-r6-camera-24-105mm-lens.jpg'], 'Full-frame mirrorless kit, brand new with warranty.', 3400000::bigint, 20000::bigint, 20, interval '190 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Sony Alpha 7 IV body', 'Electronics', array['/assets/sony-alpha-7-iv-body.jpg'], 'Full-frame mirrorless camera, brand new.', 3100000::bigint, 20000::bigint, 15, interval '210 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'GoPro HERO12 Black', 'Electronics', array['/assets/gopro-hero12-black.jpg'], 'Brand new, with mounts and a spare battery.', 520000::bigint, 2000::bigint, 57, interval '58 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'DJI Mini 4 Pro drone', 'Electronics', array['/assets/dji-mini-4-pro-drone.jpg'], 'Fly More combo with three batteries, brand new.', 1250000::bigint, 5000::bigint, 40, interval '120 hours', 'convert_to_sale', 1250000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Xbox Series X + 2 controllers', 'Electronics', array['/assets/xbox-series-x-2-controllers.jpg'], 'Brand new, 1TB, with two wireless controllers.', 950000::bigint, 4000::bigint, 47, interval '75 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Steam Deck OLED, 512GB', 'Electronics', array['/assets/steam-deck-oled-512gb.jpg'], 'Handheld gaming PC, with carry case.', 880000::bigint, 4000::bigint, 37, interval '100 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Dell XPS 13 laptop', 'Electronics', array['/assets/dell-xps-13-laptop.jpg'], '16GB, 512GB SSD, brand new with warranty.', 1750000::bigint, 10000::bigint, 18, interval '170 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Lenovo ThinkPad X1 Carbon', 'Electronics', array['/assets/lenovo-thinkpad-x1-carbon.jpg'], '16GB, 512GB SSD, UK-used in excellent condition.', 1200000::bigint, 5000::bigint, 36, interval '125 hours', 'convert_to_sale', 1200000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'iPad Pro 11-inch + Apple Pencil', 'Electronics', array['/assets/ipad-pro-11-inch-apple-pencil.jpg'], '256GB, Wi-Fi, brand new and sealed.', 1650000::bigint, 10000::bigint, 22, interval '140 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Microsoft Surface Pro', 'Electronics', array['/assets/microsoft-surface-pro.jpg'], '16GB, 256GB SSD, with keyboard.', 1450000::bigint, 5000::bigint, 25, interval '230 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Sony WI-1000X neckband earphones', 'Electronics', array['/assets/sony-wi-1000x-neckband-earphones.jpg'], 'Noise-cancelling, brand new and sealed.', 280000::bigint, 2000::bigint, 103, interval '40 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Bose QuietComfort headphones', 'Electronics', array['/assets/bose-quietcomfort-headphones.jpg'], 'Noise-cancelling, brand new with case.', 460000::bigint, 2000::bigint, 48, interval '66 hours', 'convert_to_sale', 460000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Marshall Kilburn speaker', 'Electronics', array['/assets/marshall-kilburn-speaker.jpg'], 'Portable Bluetooth speaker, brand new.', 540000::bigint, 2000::bigint, 34, interval '155 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Meta Quest 3 headset', 'Electronics', array['/assets/meta-quest-3-headset.jpg'], '128GB, with two controllers, brand new.', 790000::bigint, 4000::bigint, 36, interval '88 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Epson home cinema projector', 'Electronics', array['/assets/epson-home-cinema-projector.jpg'], 'Full HD, with a 100-inch screen.', 980000::bigint, 4000::bigint, 36, interval '135 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, '7.5kVA petrol generator', 'Home', array['/assets/7-5kva-petrol-generator.jpg'], 'Key start, brand new, delivered in Lagos.', 980000::bigint, 4000::bigint, 57, interval '55 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Chest freezer, 300L', 'Home', array['/assets/chest-freezer-300l.jpg'], 'Keeps cold for hours through power cuts. Brand new.', 620000::bigint, 2000::bigint, 64, interval '72 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Standing gas cooker, 4 burners', 'Home', array['/assets/standing-gas-cooker-4-burners.jpg'], 'With oven and grill, brand new.', 540000::bigint, 2000::bigint, 42, interval '118 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Three-seater leather sofa', 'Home', array['/assets/three-seater-leather-sofa.jpg'], 'Solid frame, delivered and set up in Lagos.', 950000::bigint, 4000::bigint, 26, interval '175 hours', 'convert_to_sale', 950000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Queen bed frame and mattress', 'Home', array['/assets/queen-bed-frame-and-mattress.jpg'], 'Solid wood frame with an orthopaedic mattress.', 780000::bigint, 4000::bigint, 34, interval '95 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Six-seater dining set', 'Home', array['/assets/six-seater-dining-set.jpg'], 'Solid wood table with six chairs.', 850000::bigint, 4000::bigint, 20, interval '205 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Robot vacuum and mop', 'Home', array['/assets/robot-vacuum-and-mop.jpg'], 'Maps your home and empties itself.', 540000::bigint, 2000::bigint, 57, interval '64 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Espresso coffee machine', 'Home', array['/assets/espresso-coffee-machine.jpg'], 'Bean-to-cup with milk frother, brand new.', 720000::bigint, 4000::bigint, 25, interval '145 hours', 'convert_to_sale', 720000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Dishwasher, 12 place settings', 'Home', array['/assets/dishwasher-12-place-settings.jpg'], 'Freestanding, installed by the store.', 690000::bigint, 4000::bigint, 13, interval '240 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Glass air fryer, 12L', 'Home', array['/assets/glass-air-fryer-12l.jpg'], 'Halogen heating, brand new with warranty.', 175000::bigint, 1000::bigint, 47, interval '34 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'All-metal floor fan', 'Home', array['/assets/all-metal-floor-fan.jpg'], 'Three speeds, brand new.', 120000::bigint, 1000::bigint, 86, interval '42 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Ceiling fan with light', 'Home', array['/assets/ceiling-fan-with-light.jpg'], 'Quiet motor, installation in Lagos included.', 145000::bigint, 1000::bigint, 68, interval '112 hours', 'convert_to_sale', 145000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Water dispenser, hot and cold', 'Home', array['/assets/water-dispenser-hot-and-cold.jpg'], 'Bottom-loading, brand new.', 195000::bigint, 1000::bigint, 36, interval '86 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Solar street light set', 'Home', array['/assets/solar-street-light-set.jpg'], 'Two lights with panels, for a gate or compound.', 240000::bigint, 1000::bigint, 31, interval '150 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Industrial sewing machine with table', 'Home', array['/assets/industrial-sewing-machine-with-table.jpg'], 'Heavy-duty, with accessories.', 260000::bigint, 1000::bigint, 26, interval '195 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Corolla 2022', 'Cars', array['/assets/toyota-corolla-2022.jpg'], 'Foreign-used, inspected, papers complete.', 26000000::bigint, 50000::bigint, 80, interval '320 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota RAV4 2021', 'Cars', array['/assets/toyota-rav4-2021.jpg'], 'Foreign-used, low mileage, inspected.', 36000000::bigint, 50000::bigint, 95, interval '360 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Highlander 2020', 'Cars', array['/assets/toyota-highlander-2020.jpg'], 'Foreign-used, seven seats, inspected.', 42000000::bigint, 50000::bigint, 152, interval '280 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Land Cruiser Prado 2021', 'Cars', array['/assets/toyota-land-cruiser-prado-2021.jpg'], 'Foreign-used, full service history.', 95000000::bigint, 50000::bigint, 206, interval '420 hours', 'convert_to_sale', 95000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Hilux 2022', 'Cars', array['/assets/toyota-hilux-2022.jpg'], 'Double cabin, foreign-used, inspected.', 48000000::bigint, 50000::bigint, 90, interval '460 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Lexus ES 350 2021', 'Cars', array['/assets/lexus-es-350-2021.jpg'], 'Foreign-used, inspected, papers complete.', 52000000::bigint, 50000::bigint, 149, interval '340 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Lexus GX 460 2020', 'Cars', array['/assets/lexus-gx-460-2020.jpg'], 'Foreign-used, full service history.', 78000000::bigint, 50000::bigint, 191, interval '390 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Honda CR-V 2020', 'Cars', array['/assets/honda-cr-v-2020.jpg'], 'Foreign-used, low mileage, inspected.', 28000000::bigint, 50000::bigint, 109, interval '260 hours', 'convert_to_sale', 28000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Honda Civic 2022', 'Cars', array['/assets/honda-civic-2022.jpg'], 'Foreign-used, one owner, inspected.', 22000000::bigint, 50000::bigint, 95, interval '230 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Hyundai Tucson 2022', 'Cars', array['/assets/hyundai-tucson-2022.jpg'], 'Foreign-used, low mileage, inspected.', 30000000::bigint, 50000::bigint, 69, interval '400 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Kia Sportage 2022', 'Cars', array['/assets/kia-sportage-2022.jpg'], 'Foreign-used, low mileage, inspected.', 29000000::bigint, 50000::bigint, 58, interval '440 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Mercedes-Benz C 300 2021', 'Cars', array['/assets/mercedes-benz-c-300-2021.jpg'], 'Foreign-used, full service history.', 55000000::bigint, 50000::bigint, 180, interval '300 hours', 'convert_to_sale', 55000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'BMW X5 2021', 'Cars', array['/assets/bmw-x5-2021.jpg'], 'Foreign-used, full service history.', 85000000::bigint, 50000::bigint, 142, interval '480 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Range Rover Sport 2023', 'Cars', array['/assets/range-rover-sport-2023.jpg'], 'Foreign-used, inspected, papers complete.', 130000000::bigint, 50000::bigint, 327, interval '410 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Ford Explorer 2020', 'Cars', array['/assets/ford-explorer-2020.jpg'], 'Foreign-used, seven seats, inspected.', 38000000::bigint, 50000::bigint, 114, interval '330 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Nike Air Force 1', 'Fashion', array['/assets/nike-air-force-1.jpg'], 'Brand new with box, sizes 40 to 46.', 145000::bigint, 1000::bigint, 105, interval '38 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Adidas Samba', 'Fashion', array['/assets/adidas-samba.jpg'], 'Brand new with box, sizes 40 to 46.', 135000::bigint, 1000::bigint, 86, interval '56 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'New Balance 574', 'Fashion', array['/assets/new-balance-574.jpg'], 'Brand new with box, sizes 40 to 46.', 150000::bigint, 1000::bigint, 76, interval '92 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Omega Speedmaster', 'Fashion', array['/assets/omega-speedmaster.jpg'], 'Pre-owned, with box and papers.', 8200000::bigint, 20000::bigint, 40, interval '300 hours', 'convert_to_sale', 8200000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'TAG Heuer Carrera', 'Fashion', array['/assets/tag-heuer-carrera.jpg'], 'Pre-owned, serviced, with box.', 3600000::bigint, 10000::bigint, 42, interval '250 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Seiko 5 automatic watch', 'Fashion', array['/assets/seiko-5-automatic-watch.jpg'], 'Brand new with warranty.', 240000::bigint, 1000::bigint, 47, interval '80 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Casio G-Shock', 'Fashion', array['/assets/casio-g-shock.jpg'], 'Brand new, shock and water resistant.', 145000::bigint, 1000::bigint, 98, interval '50 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Ray-Ban Aviator sunglasses', 'Fashion', array['/assets/ray-ban-aviator-sunglasses.jpg'], 'Authentic, with case and receipt.', 195000::bigint, 1000::bigint, 31, interval '108 hours', 'convert_to_sale', 195000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Gucci leather handbag', 'Fashion', array['/assets/gucci-leather-handbag.jpg'], 'Authentic, with receipt and dust bag.', 2400000::bigint, 10000::bigint, 32, interval '200 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Coral bead necklace set', 'Fashion', array['/assets/coral-bead-necklace-set.jpg'], 'Handmade necklace and bracelet set.', 320000::bigint, 2000::bigint, 24, interval '130 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Gold necklace and earring set', 'Fashion', array['/assets/gold-necklace-and-earring-set.jpg'], 'Hallmarked, with receipt.', 1450000::bigint, 5000::bigint, 55, interval '85 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Aso-oke fabric, 5 strips', 'Fashion', array['/assets/aso-oke-fabric-5-strips.jpg'], 'Hand-woven. Sew it to your own measure.', 120000::bigint, 1000::bigint, 43, interval '165 hours', 'convert_to_sale', 120000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Men’s tailored blazer', 'Fashion', array['/assets/men-s-tailored-blazer.jpg'], 'Wool blend, tailored to fit.', 180000::bigint, 1000::bigint, 15, interval '225 hours', 'refund', null::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Timberland 6-inch boots', 'Fashion', array['/assets/timberland-6-inch-boots.jpg'], 'Brand new with box, sizes 40 to 46.', 210000::bigint, 1000::bigint, 35, interval '115 hours', 'extend_once', null::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Eau de parfum, 100ml', 'Fashion', array['/assets/eau-de-parfum-100ml.jpg'], 'Sealed, with receipt.', 95000::bigint, 1000::bigint, 66, interval '46 hours', 'refund', null::bigint)
    ) as t(merchant, title, category, images, description, price, ticket, sold, closes_in, unsold, fallback)
  loop
    perform private.seed_listing(r.merchant, r.title, r.category, r.images, r.description, r.price, r.ticket, r.sold, r.closes_in, 'live', r.unsold, r.fallback);
  end loop;

  insert into public.listings (
    kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  select 'product', m, title, description, category, images, price * 100, 0, 0, 0, 'seller', private.platform_fee_bps(price * 100), 'refund', 0, 'for_sale', 0, 'none', '', now()
    from (values
      ('11111111-1111-4111-8111-000000000004'::uuid, 'iPhone 13, 128GB', 'UK-used, battery health 88% or better, three-month warranty.', 'Phones', array['/assets/iphone-13-128gb.jpg'], 620000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'iPhone SE, 128GB', 'Brand new and sealed. Small, light and fast.', 'Phones', array['/assets/iphone-se-128gb.jpg'], 590000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung Galaxy S23, 256GB', 'UK-used in excellent condition, with charger.', 'Phones', array['/assets/samsung-galaxy-s23-256gb.jpg'], 780000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Samsung Galaxy A15, 128GB', 'Brand new, dual SIM, with local warranty.', 'Phones', array['/assets/samsung-galaxy-a15-128gb.jpg'], 235000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Redmi 13C, 128GB', 'Brand new, dual SIM, big battery.', 'Phones', array['/assets/redmi-13c-128gb.jpg'], 165000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Tecno Spark 20, 128GB', 'Brand new, dual SIM, with local warranty.', 'Phones', array['/assets/tecno-spark-20-128gb.jpg'], 175000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Oppo Reno 11, 256GB', 'Brand new, with fast charger and case.', 'Phones', array['/assets/oppo-reno-11-256gb.jpg'], 480000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Motorola Edge 50, 256GB', 'Brand new, unlocked, with a one-year warranty.', 'Phones', array['/assets/motorola-edge-50-256gb.jpg'], 540000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Nokia G42, 128GB', 'Brand new, replaceable battery, dual SIM.', 'Phones', array['/assets/nokia-g42-128gb.jpg'], 210000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Sony Xperia 1, 256GB', 'UK-used in excellent condition, with charger.', 'Phones', array['/assets/sony-xperia-1-256gb.jpg'], 640000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Kindle Paperwhite', '16GB, waterproof, brand new.', 'Electronics', array['/assets/kindle-paperwhite.jpg'], 240000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'HP Pavilion 15 laptop', '16GB, 512GB SSD, brand new with warranty.', 'Electronics', array['/assets/hp-pavilion-15-laptop.jpg'], 890000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Beats Studio Buds', 'Wireless earbuds, brand new and sealed.', 'Electronics', array['/assets/beats-studio-buds.jpg'], 210000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Logitech wireless keyboard', 'Full size, with a long battery life.', 'Electronics', array['/assets/logitech-wireless-keyboard.jpg'], 65000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Acer 27-inch monitor', 'Full HD, brand new.', 'Electronics', array['/assets/acer-27-inch-monitor.jpg'], 220000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Garmin Forerunner watch', 'GPS running watch, brand new.', 'Electronics', array['/assets/garmin-forerunner-watch.jpg'], 480000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Amazon Echo smart speaker', 'Voice-controlled, brand new.', 'Electronics', array['/assets/amazon-echo-smart-speaker.jpg'], 95000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'SanDisk 1TB portable SSD', 'USB-C, fast and pocket-sized.', 'Electronics', array['/assets/sandisk-1tb-portable-ssd.jpg'], 165000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'TP-Link Wi-Fi 6 router', 'Dual-band, covers a whole flat.', 'Electronics', array['/assets/tp-link-wi-fi-6-router.jpg'], 95000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Canon PIXMA printer', 'Wireless, prints, copies and scans.', 'Electronics', array['/assets/canon-pixma-printer.jpg'], 145000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Microwave oven, 30L', 'With grill, brand new with warranty.', 'Home', array['/assets/microwave-oven-30l.jpg'], 165000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Kitchen blender, 1.5L', 'Glass jar, with a grinder attachment.', 'Home', array['/assets/kitchen-blender-1-5l.jpg'], 65000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Stainless steel electric kettle', 'Boils 1.7L fast, auto shut-off.', 'Home', array['/assets/stainless-steel-electric-kettle.jpg'], 38000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Four-slice toaster', 'Stainless steel, brand new.', 'Home', array['/assets/four-slice-toaster.jpg'], 52000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Steam iron', 'Non-stick plate, brand new.', 'Home', array['/assets/steam-iron.jpg'], 42000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Two-door wooden wardrobe', 'Solid wood, delivered and assembled in Lagos.', 'Home', array['/assets/two-door-wooden-wardrobe.jpg'], 420000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Solid wood bookshelf', 'Five shelves, delivered in Lagos.', 'Home', array['/assets/solid-wood-bookshelf.jpg'], 185000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Stainless steel frying pan set', 'Three pans, brand new.', 'Home', array['/assets/stainless-steel-frying-pan-set.jpg'], 120000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Pressure cooker, 6L', 'Electric, with several cooking modes.', 'Home', array['/assets/pressure-cooker-6l.jpg'], 95000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Rechargeable lantern', 'LED, with solar and mains charging.', 'Home', array['/assets/rechargeable-lantern.jpg'], 45000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Sienna 2019', 'Foreign-used, eight seats. View at our VI showroom.', 'Cars', array['/assets/toyota-sienna-2019.jpg'], 27000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Honda Pilot 2019', 'Foreign-used, inspected. View at our VI showroom.', 'Cars', array['/assets/honda-pilot-2019.jpg'], 29500000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Hyundai Elantra 2020', 'Foreign-used, one owner. View at our VI showroom.', 'Cars', array['/assets/hyundai-elantra-2020.jpg'], 16500000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Hyundai Santa Fe 2019', 'Foreign-used, inspected. View at our VI showroom.', 'Cars', array['/assets/hyundai-santa-fe-2019.jpg'], 24000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Kia Sorento 2021', 'Foreign-used, seven seats. View at our VI showroom.', 'Cars', array['/assets/kia-sorento-2021.jpg'], 23000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Kia Rio 2018', 'Nigerian-used, low mileage. View at our VI showroom.', 'Cars', array['/assets/kia-rio-2018.jpg'], 8500000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'BMW 3 Series 2019', 'Foreign-used, full service history. View at our VI showroom.', 'Cars', array['/assets/bmw-3-series-2019.jpg'], 31000000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Peugeot 3008 2020', 'Foreign-used, inspected. View at our VI showroom.', 'Cars', array['/assets/peugeot-3008-2020.jpg'], 19500000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Nissan Altima 2019', 'Foreign-used, inspected. View at our VI showroom.', 'Cars', array['/assets/nissan-altima-2019.jpg'], 15500000::bigint),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Mercedes-Benz E 350 2019', 'Foreign-used, full service history. View at our VI showroom.', 'Cars', array['/assets/mercedes-benz-e-350-2019.jpg'], 44000000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Converse Chuck Taylor', 'Brand new with box, sizes 38 to 46.', 'Fashion', array['/assets/converse-chuck-taylor.jpg'], 75000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Birkenstock Arizona sandals', 'Brand new, sizes 38 to 46.', 'Fashion', array['/assets/birkenstock-arizona-sandals.jpg'], 110000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Levi’s 501 jeans', 'Original fit, sizes 30 to 40.', 'Fashion', array['/assets/levi-s-501-jeans.jpg'], 65000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Leather belt', 'Full-grain leather, sizes 32 to 44.', 'Fashion', array['/assets/leather-belt.jpg'], 28000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Canvas and leather rucksack', 'Waxed canvas with leather straps.', 'Fashion', array['/assets/canvas-and-leather-rucksack.jpg'], 48000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Leather jacket', 'Full-grain leather, sizes S to XL.', 'Fashion', array['/assets/leather-jacket.jpg'], 125000::bigint),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Silk tie set', 'Three ties with pocket squares.', 'Fashion', array['/assets/silk-tie-set.jpg'], 35000::bigint),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Straw fedora hat', 'Hand-woven, one size.', 'Fashion', array['/assets/straw-fedora-hat.jpg'], 22000::bigint),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Leather briefcase', 'Full-grain leather, with shoulder strap.', 'Fashion', array['/assets/leather-briefcase.jpg'], 135000::bigint),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Michael Kors monogram bag', 'Authentic, with receipt.', 'Fashion', array['/assets/michael-kors-monogram-bag.jpg'], 340000::bigint)
    ) as t(m, title, description, category, images, price);
end $$;

create function private.seed_demo_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_had_listings boolean := exists (select 1 from public.listings);
begin
  perform private.seed_core_listings();
  if not v_had_listings then perform private.seed_catalog(); end if;
end $$;

revoke execute on function private.seed_core_listings(), private.seed_catalog(), private.seed_demo_data() from public, anon, authenticated;

-- A test database that already has the sample listings gets the new ones now.
-- Nothing happens outside test mode, on a database that isn't seeded yet (seed.sql
-- does it instead), or if these are somehow already there.
do $$
begin
  if (private.settings()).test_mode
     and exists (select 1 from public.listings where title = 'Toyota Camry 2025')
     and not exists (select 1 from public.listings where title = 'iPhone 16 Pro, 256GB') then
    perform private.seed_catalog();
  end if;
end $$;
