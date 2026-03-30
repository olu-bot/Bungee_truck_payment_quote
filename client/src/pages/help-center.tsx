import { useState, useRef, useEffect, type ReactNode } from "react";
import { useStripePricingDisplay } from "@/hooks/use-stripe-pricing-display";
import { formatMoney } from "@/lib/stripePricingDisplay";
import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  Route,
  Calculator,
  FileText,
  Users,
  Star,
  Clock,
  Truck,
  DollarSign,
  Shield,
  Play,
  Search,
  HelpCircle,
  Zap,
  BarChart3,
  Settings,
  MapPin,
  Fuel,
  Mail,
  MessageSquare,
  ArrowRight,
  Sparkles,
  BookOpen,
  Video,
  CircleHelp,
  CreditCard,
  ExternalLink,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════
   HELP CENTER — Bungee Connect
   Inspired by Stripe Docs, Linear, and Intercom help centers.
   ══════════════════════════════════════════════════════════════ */

/* ── Accordion ─────────────────────────────────────────────── */
function Accordion({
  question,
  answer,
}: {
  question: string;
  answer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [open]);

  return (
    <div className="group">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-[14px] font-medium text-slate-800 group-hover:text-slate-900 pr-8">
          {question}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{ maxHeight: open ? `${height}px` : "0px", opacity: open ? 1 : 0 }}
      >
        <div className="pb-4 text-[13px] text-slate-500 leading-[1.7]">
          {answer}
        </div>
      </div>
    </div>
  );
}

/* ── Topic Card (for the category grid) ────────────────────── */
function TopicCard({
  icon: Icon,
  title,
  desc,
  color,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
  onClick?: () => void;
}) {
  const colorMap: Record<string, string> = {
    orange: "bg-orange-50 text-orange-500 group-hover:bg-orange-100",
    blue: "bg-blue-50 text-blue-500 group-hover:bg-blue-100",
    emerald: "bg-emerald-50 text-emerald-500 group-hover:bg-emerald-100",
    violet: "bg-violet-50 text-violet-500 group-hover:bg-violet-100",
    rose: "bg-rose-50 text-rose-500 group-hover:bg-rose-100",
    amber: "bg-amber-50 text-amber-600 group-hover:bg-amber-100",
  };
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl border border-slate-200/80 bg-white p-5
                 hover:border-slate-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]
                 transition-all duration-200 active:scale-[0.99]"
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 transition-colors duration-200 ${colorMap[color] || colorMap.orange}`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <h3 className="text-[14px] font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
    </button>
  );
}

/* ── Video Card ────────────────────────────────────────────── */
function DemoCard({
  title,
  duration,
  tag,
}: {
  title: string;
  duration: string;
  tag: string;
}) {
  return (
    <div className="group relative flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 hover:border-slate-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 cursor-pointer">
      <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center shrink-0 group-hover:bg-slate-800 transition-colors">
        <Play className="w-4 h-4 text-white ml-0.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-slate-800 truncate">{title}</p>
        <p className="text-[12px] text-slate-400 mt-0.5">
          {tag} &middot; {duration}
        </p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all shrink-0" />
    </div>
  );
}

/* ── Tier Badge ────────────────────────────────────────────── */
function TierBadge({ tier }: { tier: "free" | "pro" | "premium" }) {
  const styles = {
    free: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
    pro: "bg-blue-50 text-blue-600 border-blue-200/60",
    premium: "bg-violet-50 text-violet-600 border-violet-200/60",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${styles[tier]}`}
    >
      {tier}
    </span>
  );
}

/* ── Feature Row ───────────────────────────────────────────── */
function FeatureRow({
  icon: Icon,
  title,
  desc,
  tier,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  tier?: "free" | "pro" | "premium";
}) {
  return (
    <div className="flex items-start gap-3.5 py-3.5">
      <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-[13px] font-semibold text-slate-800">{title}</h4>
          {tier && <TierBadge tier={tier} />}
        </div>
        <p className="text-[13px] text-slate-500 leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

/* ── Pricing Column ────────────────────────────────────────── */
function PricingCol({
  name,
  price,
  sub,
  features,
  highlight,
}: {
  name: string;
  price: string;
  sub: string;
  features: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-5 ${
        highlight
          ? "bg-slate-900 text-white ring-1 ring-slate-700"
          : "bg-white border border-slate-200/80"
      }`}
    >
      <p
        className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${highlight ? "text-orange-400" : "text-slate-400"}`}
      >
        {name}
      </p>
      <p className="text-2xl font-bold mb-0.5">{price}</p>
      <p
        className={`text-[12px] mb-4 ${highlight ? "text-slate-400" : "text-slate-400"}`}
      >
        {sub}
      </p>
      <div className="space-y-2">
        {features.map((f, i) => (
          <div key={i} className="flex items-start gap-2">
            <Zap
              className={`w-3 h-3 mt-0.5 shrink-0 ${highlight ? "text-orange-400" : "text-slate-400"}`}
            />
            <span
              className={`text-[12px] leading-relaxed ${highlight ? "text-slate-300" : "text-slate-600"}`}
            >
              {f}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

const FAQ_SECTIONS = [
  {
    label: "Getting Started",
    items: [
      {
        q: "What is Bungee Connect?",
        a: "Bungee Connect is a pricing and quoting tool built for trucking companies and carriers. Enter your route, and Bungee calculates your true operating cost, fuel surcharge, and recommended customer price — so you can quote in minutes, not hours.",
      },
      {
        q: "Who is this for?",
        a: "Owner-operators, small fleets, and mid-size carriers who want to stop guessing on price. If you run trucks and quote loads, Bungee was built for you.",
      },
      {
        q: "How do I get started?",
        a: "Sign up (free, no credit card), create a cost profile with your truck's operating costs, add your home yard, and build your first route. The whole process takes under 5 minutes.",
      },
    ],
  },
  {
    label: "Quoting & Routes",
    items: [
      {
        q: "How does the route calculation work?",
        a: "Bungee uses real road-routing data (OSRM) to calculate actual driving distance and time. It factors in every stop, then applies your cost profile to determine carrier cost, fuel surcharge, and recommended customer price.",
      },
      {
        q: "What is deadhead?",
        a: "Deadhead is the empty miles from your last delivery back to your home yard. Bungee calculates this automatically so you never forget to account for the return trip.",
      },
      {
        q: "Can I add multiple stops?",
        a: "Yes — unlimited stops. Distance, drive time, and cost recalculate in real time as you add or remove stops. Each stop can have its own dock time.",
      },
      {
        q: "How do I set my margin?",
        a: "Below the cost breakdown, choose a fixed dollar amount (e.g. +$200) or a percentage (e.g. +15%). Bungee shows carrier cost, margin, and customer price side by side.",
      },
      {
        q: "What accessorial charges are supported?",
        a: "Lumper fees, detention, TONU (Truck Ordered Not Used), hazmat surcharge, regulatory surcharge, and configurable dock time. Each is itemized in the breakdown and PDF.",
      },
      {
        q: "Where does the fuel price come from?",
        a: "Pro and Premium plans pull live diesel pricing from the U.S. Energy Information Administration (EIA), cached for 24 hours. Free users can enter a price manually.",
      },
    ],
  },
  {
    label: "Cost Profiles",
    items: [
      {
        q: "What is a cost profile?",
        a: "A cost profile represents one truck type in your fleet — its monthly payment, insurance, maintenance, permits, fuel consumption, and driver pay. Select a profile when quoting so Bungee knows your real cost to run that truck.",
      },
      {
        q: "How many can I create?",
        a: "Free plan: 2 profiles. Pro and Premium: unlimited. Useful if you run Dry Van, Reefer, and Flatbed with different cost structures.",
      },
      {
        q: "What costs should I include?",
        a: "At minimum: truck payment, insurance, maintenance, permits, driver pay, and fuel consumption. Optionally add trailer lease, ELD/telematics, office overhead, and tire reserve for more accurate quotes.",
      },
    ],
  },
  {
    label: "Quotes & PDFs",
    items: [
      {
        q: "How do I generate a PDF quote?",
        a: "Click the PDF icon on the route builder. Bungee generates a branded document with your logo, route details, and itemized pricing. Download or share via link. Requires Pro or Premium.",
      },
      {
        q: "Can I customize the PDF?",
        a: "Yes — Pro and Premium users can edit the template: adjust layout, add your logo, and control which line items appear.",
      },
      {
        q: "How do I track won/lost quotes?",
        a: "In Quote History, click any quote's status to mark it Won or Lost. Over time you'll see your win rate by lane, truck type, or time period.",
      },
    ],
  },
  {
    label: "Team & Account",
    items: [
      {
        q: "How do I invite team members?",
        a: "Go to Team, click Invite, enter an email and choose a role (Admin or Member). They'll get an email to join your workspace. Pro: up to 5 members. Premium: unlimited.",
      },
      {
        q: "What are the team roles?",
        a: "Owner: full access including billing. Admin: edit profiles, manage yards, invite/remove members. Member: build routes, create quotes, share PDFs.",
      },
      {
        q: "How do I change my plan?",
        a: "The Owner can manage the subscription from billing settings. Upgrades are instant. Downgrades keep current features until the end of the billing period. All payments go through Stripe.",
      },
      {
        q: "Is my data secure?",
        a: "Yes. Firebase Authentication (including Google OAuth) for sign-in, Firestore for encrypted storage. Your data is isolated to your company workspace and never shared.",
      },
    ],
  },
];

/* ── Tour Banner — multi-tour selector ─────────────────────── */
const TOUR_LIST = [
  {
    id: "overview" as const,
    title: "Getting Started",
    description: "Build your first quote in 2 minutes",
    icon: Sparkles,
  },
  {
    id: "quote-history" as const,
    title: "Quote History & Win/Loss",
    description: "Track quotes, mark wins & losses, download PDFs",
    icon: BarChart3,
  },
  {
    id: "advanced-quote" as const,
    title: "Advanced Quoting Mode",
    description: "Cost breakdowns, charges, and leg details",
    icon: Calculator,
  },
];

function TourBanner() {
  const [, setLocation] = useLocation();

  const startTour = (tourId: string) => {
    /* Navigate home (or history for quote-history tour), then dispatch */
    const dest = tourId === "quote-history" ? "/history" : "/";
    setLocation(dest);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("bungee:start-tour", { detail: { tourId } })
      );
    }, 400);
  };

  return (
    <section className="pt-8 pb-0">
      <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
        Interactive Walkthroughs
      </p>
      <div className="flex flex-col gap-2">
        {TOUR_LIST.map((tour) => {
          const Icon = tour.icon;
          return (
            <button
              key={tour.id}
              data-testid={`button-tour-${tour.id}`}
              onClick={() => startTour(tour.id)}
              className="group flex items-center gap-3 w-full rounded-xl border border-dashed border-orange-300/60
                         bg-orange-50/40 px-4 py-3 hover:bg-orange-50 hover:border-orange-300 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-200 transition-colors">
                <Icon className="w-4 h-4 text-orange-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">
                  {tour.title}
                </p>
                <p className="text-[12px] text-slate-500">
                  {tour.description}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFaqSection, setActiveFaqSection] = useState(0);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const { data: stripePricing } = useStripePricingDisplay();
  const helpProPrice = stripePricing?.pro?.month
    ? `${formatMoney(stripePricing.pro.month.amount, stripePricing.pro.month.currency)}/mo`
    : "$29/mo";
  const helpPremiumPrice = stripePricing?.premium?.month
    ? `${formatMoney(stripePricing.premium.month.amount, stripePricing.premium.month.currency)}/mo`
    : "$59/mo";

  const scrollTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  /* Filter FAQ by search */
  const filteredFaq = searchQuery.trim()
    ? FAQ_SECTIONS.map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (item) =>
            item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.a.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter((sec) => sec.items.length > 0)
    : FAQ_SECTIONS;

  return (
    <div className="min-h-screen bg-white">
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden bg-[#fafafa] border-b border-slate-100">
        {/* Subtle dot grid texture */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #d4d4d8 0.8px, transparent 0.8px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Gradient fade on edges */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-transparent to-white/60" />

        <div className="relative max-w-3xl mx-auto px-4 pt-14 pb-12 text-center">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1 mb-5 shadow-sm">
            <Sparkles className="w-3 h-3 text-orange-400" />
            Help Center
          </div>

          <h1 className="text-[28px] sm:text-[34px] font-bold text-slate-900 tracking-tight leading-tight mb-3">
            How can we help?
          </h1>
          <p className="text-[15px] text-slate-500 max-w-md mx-auto mb-8 leading-relaxed">
            Guides, answers, and video walkthroughs to help you get the most out
            of Bungee Connect.
          </p>

          {/* Search */}
          <div className="relative max-w-lg mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for answers..."
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-white border border-slate-200 text-[14px] text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-300
                         shadow-sm transition-shadow hover:shadow"
            />
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4">
        {/* ─── TOUR BANNER ─── */}
        <TourBanner />

        {/* ─── TOPIC GRID ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["topics"] = el)}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Browse by topic
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <TopicCard
              icon={Route}
              title="Route Builder"
              desc="Build routes, add stops, and calculate distances"
              color="orange"
              onClick={() => scrollTo("faq")}
            />
            <TopicCard
              icon={Calculator}
              title="Cost & Pricing"
              desc="Understand your cost breakdown and margins"
              color="blue"
              onClick={() => scrollTo("faq")}
            />
            <TopicCard
              icon={Settings}
              title="Cost Profiles"
              desc="Set up equipment costs for your fleet"
              color="emerald"
              onClick={() => scrollTo("faq")}
            />
            <TopicCard
              icon={FileText}
              title="PDF Quotes"
              desc="Generate and customize branded quotes"
              color="violet"
              onClick={() => scrollTo("faq")}
            />
            <TopicCard
              icon={Users}
              title="Team & Roles"
              desc="Invite members and manage permissions"
              color="rose"
              onClick={() => scrollTo("faq")}
            />
            <TopicCard
              icon={CreditCard}
              title="Billing & Plans"
              desc="Free, Pro, and Premium plan details"
              color="amber"
              onClick={() => scrollTo("pricing")}
            />
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── QUICK START ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["start"] = el)}>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900">
              Get started in 5 minutes
            </h2>
          </div>

          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-200" />

            {[
              {
                title: "Create your account",
                desc: "Sign up with Google or email. Enter your company name, fleet size, and preferred units.",
              },
              {
                title: "Set up a cost profile",
                desc: "Add your truck's operating costs — payment, insurance, fuel, driver pay. This powers every quote.",
              },
              {
                title: "Add your home yard",
                desc: "Set your base location so Bungee can calculate deadhead miles automatically.",
              },
              {
                title: "Build your first route",
                desc: "Enter pickup and delivery addresses, select a profile, and see your cost breakdown instantly.",
              },
              {
                title: "Save and share",
                desc: "Save to history, generate a PDF, or share a link with your customer.",
              },
            ].map((step, i) => (
              <div key={i} className="relative flex items-start gap-3 pb-5 last:pb-0">
                <div className="w-[22px] h-[22px] rounded-full bg-white border-2 border-slate-200 flex items-center justify-center shrink-0 -ml-[5px] z-10">
                  <span className="text-[10px] font-bold text-slate-500">
                    {i + 1}
                  </span>
                </div>
                <div className="pt-0.5">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {step.title}
                  </p>
                  <p className="text-[13px] text-slate-500 leading-relaxed mt-0.5">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── VIDEO DEMOS ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["videos"] = el)}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <Video className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <h2 className="text-[16px] font-semibold text-slate-900">
                Video walkthroughs
              </h2>
            </div>
            <span className="text-[12px] text-slate-400">Coming soon</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5">
            <DemoCard title="Getting started with Bungee Connect" duration="4:30" tag="Quick Start" />
            <DemoCard title="Building a multi-stop route" duration="3:15" tag="Route Builder" />
            <DemoCard title="Setting up cost profiles" duration="5:00" tag="Profiles" />
            <DemoCard title="Generating branded PDF quotes" duration="2:45" tag="PDFs" />
            <DemoCard title="Managing your team" duration="3:00" tag="Team" />
            <DemoCard title="Tracking quotes and win rates" duration="2:30" tag="History" />
            <DemoCard title="Deadhead and fuel surcharge explained" duration="3:45" tag="Costs" />
            <DemoCard title="Using favorite lanes" duration="1:50" tag="Lanes" />
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── FEATURES ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["features"] = el)}>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900">
              What you can do with Bungee
            </h2>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white divide-y divide-slate-100 px-4">
            <FeatureRow
              icon={Route}
              title="Multi-stop route builder"
              desc="Add unlimited pickup and delivery stops with auto-calculated distance, drive time, and optimal routing."
              tier="free"
            />
            <FeatureRow
              icon={Calculator}
              title="Instant cost calculation"
              desc="See your true carrier cost — fixed costs, fuel, driver pay, dock time, and deadhead — before you name a price."
              tier="free"
            />
            <FeatureRow
              icon={DollarSign}
              title="Smart margin control"
              desc="Set margin as a fixed amount or percentage. See carrier cost, margin, and customer price side by side."
              tier="free"
            />
            <FeatureRow
              icon={Fuel}
              title="Live fuel pricing"
              desc="Pull real-time diesel from the U.S. Energy Information Administration so your fuel surcharge is always current."
              tier="pro"
            />
            <FeatureRow
              icon={Settings}
              title="Equipment cost profiles"
              desc="Create profiles per truck type (Dry Van, Reefer, Flatbed) with every operating cost itemized."
              tier="free"
            />
            <FeatureRow
              icon={FileText}
              title="Branded PDF quotes"
              desc="Generate professional quotes with your logo and customizable template. Download or share via link."
              tier="pro"
            />
            <FeatureRow
              icon={Star}
              title="Favorite lanes"
              desc="Save your most-run routes for one-click quoting. Stop re-entering the same lanes every week."
              tier="free"
            />
            <FeatureRow
              icon={Clock}
              title="Quote history & tracking"
              desc="Every quote is saved. Search by route, date, or status. Mark as Won or Lost to track win rates."
              tier="free"
            />
            <FeatureRow
              icon={BarChart3}
              title="CSV export"
              desc="Export quote history to CSV for deeper analysis in Excel or Google Sheets."
              tier="pro"
            />
            <FeatureRow
              icon={Users}
              title="Team management"
              desc="Invite dispatchers, admins, and drivers. Control who edits profiles, manages billing, or creates quotes."
              tier="pro"
            />
            <FeatureRow
              icon={MapPin}
              title="Multiple yards"
              desc="Add yard locations across your network. Select the closest for accurate deadhead calculations."
              tier="pro"
            />
            <FeatureRow
              icon={Shield}
              title="Role-based access"
              desc="Three levels — Owner, Admin, Member — so everyone sees exactly what they need."
              tier="pro"
            />
            <FeatureRow
              icon={Truck}
              title="Accessorial charges"
              desc="Lumper, detention, TONU, hazmat, regulatory surcharge, and configurable dock time — all itemized."
              tier="free"
            />
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── FAQ ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["faq"] = el)}>
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <CircleHelp className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900">
              Frequently asked questions
            </h2>
          </div>

          {/* Section tabs */}
          {!searchQuery.trim() && (
            <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
              {FAQ_SECTIONS.map((sec, i) => (
                <button
                  key={sec.label}
                  onClick={() => setActiveFaqSection(i)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
                    activeFaqSection === i
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>
          )}

          {/* FAQ content */}
          <div className="rounded-xl border border-slate-200/80 bg-white px-5 divide-y divide-slate-100">
            {searchQuery.trim() ? (
              filteredFaq.length > 0 ? (
                filteredFaq.flatMap((sec) =>
                  sec.items.map((item, j) => (
                    <Accordion key={`${sec.label}-${j}`} question={item.q} answer={item.a} />
                  ))
                )
              ) : (
                <div className="py-8 text-center">
                  <p className="text-[13px] text-slate-400">
                    No results for "{searchQuery}". Try a different search.
                  </p>
                </div>
              )
            ) : (
              FAQ_SECTIONS[activeFaqSection].items.map((item, j) => (
                <Accordion key={j} question={item.q} answer={item.a} />
              ))
            )}
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── PRICING ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["pricing"] = el)}>
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <CreditCard className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900">
              Plans & pricing
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <PricingCol
              name="Free"
              price="$0"
              sub="No credit card required"
              features={[
                "300 route quotes per month",
                "AI Chatbot",
                "Map visualization",
                "3-tier pricing suggestion",
                "2 cost profiles",
                "1 yard, 1 user",
                "Quote history up to 30 days",
                "Accessorial charges",
                "Live fuel price updates",
              ]}
            />
            <PricingCol
              name="Pro"
              price={helpProPrice}
              sub="Most popular for small fleets"
              highlight
              features={[
                "Everything in free plus",
                "Unlimited cost profiles",
                "Unlimited route quotes",
                "Unlimited quote history",
                "Unlimited yards",
                "5 users, role based access",
                "CSV export",
                "Branded PDF quote export",
              ]}
            />
            <PricingCol
              name="Premium"
              price={helpPremiumPrice}
              sub="For growing teams"
              features={[
                "Everything in pro plus",
                "Unlimited users - $15/seat after 5",
                "Lane rate intelligence",
                "Customer quote portal",
                "Dispatch view",
                "API access",
                "Priority support",
              ]}
            />
          </div>
        </section>

        <div className="h-px bg-slate-100" />

        {/* ─── CONTACT ─── */}
        <section className="py-10" ref={(el) => (sectionRefs.current["contact"] = el)}>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900">
              Still need help?
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200/80 bg-white p-5">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center mb-3">
                <MessageSquare className="w-4 h-4 text-orange-500" />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1">
                In-app feedback
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Click Feedback in the sidebar. Our team reads every message and
                responds within 24 hours.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
                <Mail className="w-4 h-4 text-blue-500" />
              </div>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1">
                Email us
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Reach{" "}
                <span className="text-orange-600 font-medium">
                  support@shipbungee.com
                </span>{" "}
                for billing, partnerships, or anything else. We respond within
                one business day.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <div className="py-6 text-center border-t border-slate-100">
          <p className="text-[12px] text-slate-400">
            Bungee Connect &mdash; Built for carriers, by carriers.
          </p>
        </div>
      </div>
    </div>
  );
}
