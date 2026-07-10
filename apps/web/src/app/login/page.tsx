import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { ArmiLogo } from '@/components/brand/ArmiLogo';
import { AtlasMark } from '@/components/brand/AtlasMark';
import { Icon } from '@/components/ui/Icon';
import { TopoBackground } from '@/components/ui/TopoBackground';

const STATS = [
  { value: '481', label: 'marchés suivis' },
  { value: '12', label: 'régions couvertes' },
  { value: '6', label: 'divisions métier' },
];

export default async function LoginPage() {
  const session = await auth();
  // Only bounce to the app when the session is actually usable. A stale session
  // (user present but the access token is gone / refresh failed) must render the
  // login screen to re-authenticate — otherwise /login ⇄ / loops forever
  // (apiGet redirects back here on a dead token) → ERR_TOO_MANY_REDIRECTS.
  if (
    session?.user &&
    session.accessToken &&
    session.error !== 'RefreshAccessTokenError'
  ) {
    redirect('/');
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      {/* Editorial hero */}
      <div className="relative hidden overflow-hidden bg-rail lg:block">
        <Image
          src="/brand/atlas-hero.webp"
          alt="Barrage et réseau hydraulique de l'Atlas marocain, vision ATLAS"
          fill
          priority
          sizes="55vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-rail via-rail/55 to-rail/15" />
        <div className="brand-seam absolute inset-x-0 top-0 h-1" />
        <div className="relative flex h-full flex-col justify-between p-12 text-paper">
          <ArmiLogo variant="rail" markSize={42} />
          <div className="max-w-lg">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-ochre">
              Système d&apos;exploitation d&apos;entreprise
            </p>
            <h1 className="font-display text-[2.7rem] font-semibold leading-[1.05]">
              L&apos;entreprise, orchestrée d&apos;un seul regard.
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-paper/70">
              Marchés publics, chantiers, trésorerie et veille concurrentielle —
              détectés par des agents, pilotés par vos équipes.
            </p>
            <div className="mt-9 flex gap-8">
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="font-display text-3xl font-semibold tabular-nums text-paper">
                    {s.value}
                  </div>
                  <div className="mt-0.5 text-xs uppercase tracking-wider text-paper/50">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-paper/40">
            AGHA RM INFRA — Infrastructure hydraulique &amp; génie civil
          </div>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="relative flex items-center justify-center overflow-hidden bg-paper px-6 py-12">
        <TopoBackground opacity={0.04} />
        <div className="relative w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <ArmiLogo variant="light" />
          </div>
          <div className="rounded-xl border border-line bg-paper-2 p-8 shadow-raised">
            <AtlasMark size={46} />
            <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">
              Connexion
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Accès réservé au personnel d&apos;AGHA RM INFRA.
            </p>
            <form
              action={async () => {
                'use server';
                await signIn('keycloak', { redirectTo: '/' });
              }}
              className="mt-7"
            >
              <button className="flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:bg-ink-2">
                Se connecter
                <Icon name="chevronRight" size={16} />
              </button>
            </form>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-faint">
              <Icon name="vault" size={13} />
              Authentification sécurisée via Keycloak (SSO).
            </p>
          </div>
          <p className="mt-6 text-center text-xs text-faint">
            © 2026 AGHA RM INFRA · plateforme ATLAS
          </p>
        </div>
      </div>
    </div>
  );
}
