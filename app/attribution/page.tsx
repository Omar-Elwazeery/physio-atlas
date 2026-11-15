import Link from 'next/link';
import { CONTRIBUTING_URL, SOURCE_LIST, citation, reviewStats } from '../lib/data/sources';

export const metadata = { title: 'Credits and licences — Physio Atlas' };

export default function Attribution() {
  const stats = reviewStats();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', lineHeight: 1.6 }}>
      <p><Link href="/" style={{ color: 'var(--lavender)' }}>← Back to the atlas</Link></p>
      <h1>Credits and licences</h1>

      <h2>3D anatomy</h2>
      <p>
        <strong>Bones, joint cartilage, menisci, labra, intervertebral discs, the limb muscles with their tendons, and the
        ligaments, joint capsules, bursae, tendon sheaths, retinacula and fasciae of the limbs and pelvis</strong> are adapted from the{' '}
        <a href="https://anatomytool.org/open3dmodel" style={{ color: 'var(--lavender)' }}>Open 3D Model</a> of the AnatomyTOOL
        consortium (project lead Paul Gobée, Leiden University Medical Center; modellers Eungyeol Lee and Emily Fong, with
        Emily Lowes, Greet Mommen, Mieke Roth and Matty Spinder; web models Daniël Jansma; anatomists and other contributors as
        listed on the project&apos;s{' '}
        <a href="https://anatomytool.org/open3dmodel-credit" style={{ color: 'var(--lavender)' }}>credit page</a>). As far as we
        could establish, the Open 3D Model is in turn derived from{' '}
        <a href="https://www.z-anatomy.com" style={{ color: 'var(--lavender)' }}>Z-Anatomy</a> and BodyParts3D.
      </p>
      <p>
        These models were converted to compressed glTF, renamed to this atlas&apos;s structure names, mirrored to make the left
        side, moved into the atlas&apos;s frame, and partly simplified; the bone surface-detail (normal map) textures and the
        muscle fibre (colour) textures are included unchanged. From the Open 3D Model come 98 of the atlas&apos;s 170 muscles: every
        muscle of the arm, forearm, hand, hip, thigh, leg and foot except adductor pollicis and adductor minimus, and the shoulder-girdle muscles other than deltoid,
        pectoralis major and trapezius. Their tendons are shown as parts of the muscle; a tendon that several muscles share
        is attached to one of them (the calcaneal tendon to gastrocnemius, the quadriceps tendon and patellar ligament to
        rectus femoris, the pes anserinus to sartorius). The ligaments and the other soft tissue of the joints were named,
        split per digit where the source holds several digits in one object, mirrored and bound to the bones they attach
        to so that they move with the joints; where the source draws a ligament only as a see-through highlight over the
        capsule (the glenohumeral, iliofemoral and medial collateral ligaments, among others), that outline is drawn here as
        an opaque ligament, and highlights that do not read as a structure were left out. The Open 3D Model is licensed under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" style={{ color: 'var(--lavender)' }}>Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)</a>, and the
        adaptations are offered on the same terms.
      </p>
      <p>
        <strong>The other muscles and the hyoid bone</strong> (all trunk, neck and head muscles; deltoid, pectoralis major and
        trapezius, which the atlas shows in parts that the Open 3D Model does not separate; adductor pollicis, adductor minimus
        and coccygeus) come from BodyParts3D, © The Database Center for Life Science, licensed under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/2.1/jp/" style={{ color: 'var(--lavender)' }}>Creative Commons Attribution-Share Alike 2.1 Japan</a>.
        Source: <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html" style={{ color: 'var(--lavender)' }}>dbarchive.biosciencedbc.jp</a>.
        They were converted to glTF, simplified, re-oriented, merged into per-structure groups, compressed, and reshaped to fit
        the Open 3D Model bones; their colour was matched to the Open 3D Model muscle texture. Because the licence is Share-Alike, those adapted models are offered under the same licence
        (CC BY-SA 2.1 Japan).
      </p>
      <p>
        A few muscles that BodyParts3D does not include (for example latissimus dorsi, rectus abdominis and masseter) are drawn
        as simplified <strong>schematic</strong> shapes by this project and are marked as such in the structure panel. The full
        credits also ship with the models, in <code>public/models/ATTRIBUTION.md</code>.
      </p>

      <h2>Clinical content</h2>
      <p>
        Origins, insertions, innervation, actions and ranges of motion are educational summaries based on standard anatomy and
        goniometry references (Gray&apos;s Anatomy, Kendall&apos;s Muscles, AAOS normative ranges). They have not been clinically
        reviewed. Do not use this atlas for diagnosis or treatment decisions.
      </p>

      <h2>Clinical references</h2>
      <p>
        These are the standard texts that each muscle entry is meant to be checked against. Being listed here does{' '}
        <strong>not</strong> mean an entry has been checked: an entry shows these references in the structure panel only once someone
        has recorded that they verified it. So far {stats.reviewed} of {stats.total} muscle entries have been reviewed, and {stats.withRefs} list a reference.
      </p>
      <ul>
        {SOURCE_LIST.map((s) => <li key={s.id}>{citation(s)}</li>)}
      </ul>
      <p>
        To check an entry and record it, see the{' '}
        <a href={CONTRIBUTING_URL} style={{ color: 'var(--lavender)' }}>contributing guide</a>.
      </p>

      <h2>Software</h2>
      <p>Built with three.js, GSAP, React and Next.js.</p>
    </main>
  );
}
