import Link from 'next/link';

export const metadata = { title: 'Credits and licences — Physio Atlas' };

export default function Attribution() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', lineHeight: 1.6 }}>
      <p><Link href="/" style={{ color: 'var(--lavender)' }}>← Back to the atlas</Link></p>
      <h1>Credits and licences</h1>

      <h2>3D anatomy</h2>
      <p>
        BodyParts3D, © The Database Center for Life Science, licensed under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/2.1/jp/" style={{ color: 'var(--lavender)' }}>Creative Commons Attribution-Share Alike 2.1 Japan</a>.
        Source: <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html" style={{ color: 'var(--lavender)' }}>dbarchive.biosciencedbc.jp</a>.
      </p>
      <p>
        The models in this atlas are adapted from BodyParts3D: they were converted to glTF, simplified, re-oriented, merged
        into per-structure groups and compressed. Because the licence is Share-Alike, those adapted models are offered under the
        same licence (CC BY-SA 2.1 Japan).
      </p>
      <p>
        A few muscles that BodyParts3D does not include (for example latissimus dorsi, rectus abdominis and masseter) are drawn
        as simplified <strong>schematic</strong> shapes by this project and are marked as such in the structure panel.
      </p>

      <h2>Clinical content</h2>
      <p>
        Origins, insertions, innervation, actions and ranges of motion are educational summaries based on standard anatomy and
        goniometry references (Gray&apos;s Anatomy, Kendall&apos;s Muscles, AAOS normative ranges). They have not been clinically
        reviewed. Do not use this atlas for diagnosis or treatment decisions.
      </p>

      <h2>Software</h2>
      <p>Built with three.js, GSAP, React and Next.js.</p>
    </main>
  );
}
