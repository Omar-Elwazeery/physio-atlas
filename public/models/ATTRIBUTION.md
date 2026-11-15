# Attribution for the 3D models in this folder

The files here (`skeleton.glb`, `joints.glb`, `muscles.glb`, `ligaments.glb`, `structures.json`) are **adaptations**
of two open anatomy datasets. They were built by `npm run models` (see the README, "Rebuilding the models").

## Open 3D Model (bones, articular cartilage, fibrocartilage, intervertebral discs, costal cartilage, limb muscles and tendons, ligaments, joint capsules, bursae, tendon sheaths, retinacula, fasciae)

- **Open 3D Model**, AnatomyTOOL consortium (https://anatomytool.org/open3dmodel). Files as published for the
  Open 3D Model viewer at caskanatomy.info (`overview-skeleton.glb`, `upper-limb.glb`, `lower-limb.glb`; SHA-256 values in
  `scripts/lib/open3d.ts`).
- Project lead: Paul (O.P.) Gobée, Leiden University Medical Center, dept. Anatomy & Embryology.
- Modellers: Eungyeol (E.) Lee (complete body modelling except head), Emily (E.) Fong (head modelling).
  Contributing modellers: Emily (E.C.A.) Lowes, Greet (G.) Mommen, Mieke (M.) Roth, Matty (M.) Spinder.
  Web viewer and web models: Daniël (D.) Jansma. Anatomists and other contributors as listed on the project's credit page
  (https://anatomytool.org/open3dmodel-credit).
- As far as we could establish, the Open 3D Model is itself derived from **Z-Anatomy** and **BodyParts3D** (below);
  its geometry and posture match BodyParts3D closely.

What was changed: converted to Draco-compressed glTF; names cleaned and re-keyed to this atlas's structure ids; the
right-side objects mirrored to make the left side; moved into the atlas's coordinate frame (standing on y = 0);
cartilage simplified; articular-cartilage objects that cover several bones split per bone; nucleus pulposus split per
disc level; teeth merged per arch. The bone normal-map textures are included unchanged.

Limb muscles and tendons (98 of the atlas's 170 muscles, both sides): the shoulder-girdle muscles except deltoid,
pectoralis major and trapezius (supraspinatus, infraspinatus, subscapularis, teres major and minor, levator scapulae,
rhomboids, serratus anterior, pectoralis minor, subclavius), and every muscle of the arm, forearm, hand (except
adductor pollicis), hip, thigh, leg and foot. Changes: re-keyed to the atlas's muscle ids and parts (heads kept as
parts; separate tendon and aponeurosis objects attached as parts of their muscle, a shared tendon to one muscle: the
calcaneal tendon to gastrocnemius, the quadriceps tendon and patellar ligament to rectus femoris, the pes anserinus to
sartorius, the common proximal hamstring tendon to biceps femoris, the palmar aponeurosis to palmaris longus); the
single objects holding the lumbricals and the plantar interossei of the foot split into one structure per muscle;
right side mirrored to make the left; vertices lying inside a bone pushed just outside it. The muscle base-colour
(fibre) textures and the extensor-hood normal maps are included unchanged (JPEG, as published). The lateral bands and
intertendinous connections of the fingers and the extensor apparatus of the toes were added to their muscles as tendon
parts.

Ligaments and the other soft tissue of the joints (`ligaments.glb`): ligaments and interosseous membranes, joint
capsules and the synovial membrane of the knee, the infrapatellar fat pad, bursae, synovial and fibrous tendon
sheaths, retinacula, deep fasciae, intermuscular septa, the iliotibial tract and the plantar and gluteal aponeuroses of
the upper- and lower-limb files. Changes: re-keyed to this atlas's structure ids and named; capsules, collateral
ligaments, palmar/plantar plates and sheaths of the digits split into one structure per digit; some of the
see-through "overlay" shells the source draws over a capsule or bone (the glenohumeral, iliofemoral, pubofemoral,
ischiofemoral, medial collateral and other ligaments) drawn as opaque ligaments, the others left out (the list and the
reasons are in `scripts/lib/open3d.ts`, OVERLAY_SKIP); meshes simplified; right side mirrored to make the left; the
bones each structure is fixed to found from contact with the bone surfaces, and a proximity skin baked into the file
so the structures move with those bones. The tendon and retinaculum textures are those of `muscles.glb` (referenced by
name, not stored twice); the capsule, membrane and sheath normal maps are included unchanged (JPEG, as published).

**Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0,
https://creativecommons.org/licenses/by-sa/4.0/)**, confirmed by the project owner from the Open 3D
Model's own pages on 2026-11-13. Because the licence is Share-Alike, the adapted files, including `ligaments.glb`, are
offered under the same licence.

## BodyParts3D (trunk, neck and head muscles, deltoid, pectoralis major, trapezius, adductor pollicis, adductor minimus, coccygeus, hyoid bone)

- **BodyParts3D**, © The Database Center for Life Science (DBCLS), licensed under Creative Commons
  Attribution-Share Alike 2.1 Japan (https://creativecommons.org/licenses/by-sa/2.1/jp/).
  Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html
- What was changed: converted to glTF, simplified, re-oriented, merged into per-structure groups, compressed; the
  muscles were then moved and reshaped to fit the Open 3D Model bones (per-bone fits blended with the muscles' skin
  weights, a local surface correction and a push-out of any part left inside a bone). The adapted models are offered
  under CC BY-SA 2.1 Japan.
- These are 64 of the atlas's 170 muscles: all 59 trunk, neck and head muscles that are not schematic (the Open 3D Model
  files used here have none, apart from coccygeus, kept with the BodyParts3D pelvic floor); deltoid, pectoralis major
  and trapezius, which the atlas shows in parts (clavicular / acromial / spinal etc.) that the Open 3D Model does not
  separate; adductor pollicis (oblique and transverse heads, one object in the Open 3D Model); adductor minimus (only an
  overlay shell in the Open 3D Model). Their colour was matched to the Open 3D Model fibre texture.
- Eight muscles that BodyParts3D lacks (latissimus dorsi, rectus abdominis, internal oblique, transversus abdominis,
  quadratus lumborum, multifidus, masseter, temporalis) are approximate **schematic** shapes generated by this project
  between attachment sites on the bones.

## Z-Anatomy

- **Z-Anatomy** (https://www.z-anatomy.com), an open atlas built on BodyParts3D. Credited here as an upstream source of
  the Open 3D Model geometry.
