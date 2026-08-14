export const selectedWork = [
  {
    type: "Professional work · Deel",
    title: "Payroll at enterprise scale",
    description: [
      "I work on payroll systems that need to handle different countries, company sizes and regulatory requirements without becoming impossible to reason about.",
      "One of the more demanding projects involved scaling real-time payroll processing for enterprise customers with more than 10,000 employees. The challenge was not simply processing more records. We had to keep the workflow reliable, observable and manageable for the people operating it.",
      "I also helped automate payroll-liability workflows that collect taxes, social-insurance contributions, pensions and other statutory amounts for funding and payment. That removed more than 90% of the manual work from the process.",
    ],
    tags: ["TypeScript", "Node.js", "PostgreSQL", "NATS", "Payroll"],
  },
  {
    type: "Professional work · Deel",
    title: "AI workflows that take real actions",
    description: [
      "I build AI-powered workflows using the Claude Agent SDK and distributed workers running on Kubernetes.",
      "These are not isolated chat experiences. The workflows retrieve data, make decisions and trigger actions inside business processes. That changes what matters: permissions need to be explicit, execution needs to be traceable and every step needs a sensible recovery path.",
      "Working on these systems has made me much more interested in agent evaluation, orchestration and reliability than in clever prompts on their own.",
    ],
    tags: ["Claude Agent SDK", "Kubernetes", "Agents", "Reliability"],
  },
  {
    type: "Product engineering · Brave",
    title: "Brave Wallet",
    description: [
      "I worked across the browser, backend and blockchain layers of Brave Wallet as it grew to more than 10 million active users.",
      "My work included Solana support, NFT experiences across EVM and Solana, Filecoin, market-data integrations, fiat on-ramps and backend APIs used by millions of clients.",
      "It was a useful lesson in balancing privacy, performance, security and usability in a product dealing with real assets.",
    ],
    tags: ["TypeScript", "Solana", "EVM", "Browser systems"],
    link: { label: "Visit Brave Wallet", href: "https://brave.com/wallet/" },
  },
  {
    type: "Personal project · Open source",
    title: "Webhook Tester",
    description: [
      "A lightweight tool for receiving, inspecting and debugging webhooks.",
      "I built it in Go because webhook failures are much easier to solve when you can see the exact request instead of reconstructing it from logs and guesses.",
    ],
    tags: ["Go", "Webhooks", "Developer tools"],
    link: { label: "View on GitHub", href: "https://github.com/muliswilliam/webhook-tester" },
  },
];

export const additionalWork = [
  {
    type: "Personal project",
    title: "SecureShare",
    description: [
      "A small tool for sharing sensitive information without treating the server as a trusted reader.",
      "SecureShare explores client-side encryption and simple peer-to-peer communication. It started from a basic question: how little does a server actually need to know for two people to exchange something securely?",
    ],
    tags: ["Encryption", "WebRTC", "Privacy"],
    link: { label: "View on GitHub", href: "https://github.com/muliswilliam/secureshare" },
  },
  {
    type: "Professional work · Transparency International",
    title: "Civic reporting tools",
    description: [
      "I worked on secure reporting tools for people submitting sensitive corruption cases, including cross-platform applications that reached more than 50,000 users.",
      "That work made privacy and user trust feel concrete. Security was not a line in a requirements document; it affected whether someone felt safe enough to use the product at all.",
    ],
    tags: ["Node.js", "Mobile", "Civic technology", "Privacy"],
  },
  {
    type: "Professional work · BBC",
    title: "Interactive news and data",
    description: [
      "At the BBC, I built interactive news applications and data visualisations using React, D3.js and Chart.js.",
      "The work taught me to make complicated information understandable without hiding the uncertainty or detail that matters.",
    ],
    tags: ["React", "D3.js", "Data visualisation", "Media"],
  },
];

export const experiencePreview = [
  {
    company: "Deel",
    role: "Senior Software Engineer and Team Lead · 2024–now",
    summary:
      "Payroll infrastructure, event-driven backend services and AI-powered workflows. I also mentor engineers and help guide architecture and delivery decisions.",
  },
  {
    company: "Brave Software",
    role: "Senior Software Engineer · 2021–2024",
    summary:
      "Worked across browser, backend and blockchain systems for Brave Wallet, including Solana, NFTs, fiat on-ramps and wallet APIs.",
  },
  {
    company: "Fitts",
    role: "Senior Software Engineer and Team Lead · 2020–2022",
    summary: "Led a team of ten engineers while remaining hands-on with architecture, delivery, CI/CD and production reliability.",
  },
  {
    company: "Humanitec",
    role: "Senior Software Developer · 2019–2020",
    summary: "Built React and Angular applications for enterprise developer platforms and contributed to a micro-frontend architecture.",
  },
  {
    company: "BBC",
    role: "Software Engineer · 2018–2019",
    summary: "Built interactive news applications, data visualisations and frontend delivery tooling.",
  },
];

export const fullExperience = [
  {
    company: "Deel",
    role: "Senior Software Engineer and Team Lead",
    dates: "February 2024–present",
    summary: [
      "I lead engineering work across Deel Payroll and build AI-powered workflows for Akai.",
      "On the payroll side, I work on event-driven services using TypeScript, Node.js, PostgreSQL, Redis and NATS. One project involved scaling real-time payroll processing for enterprise customers with more than 10,000 employees. Another automated payroll liabilities across taxes, social insurance, pensions and statutory levies, removing more than 90% of the manual work.",
      "On the AI side, I build agent workflows using the Claude Agent SDK and distributed Kubernetes workers. I also mentor engineers through system design, planning, code reviews and operational reviews.",
    ],
  },
  {
    company: "Brave Software",
    role: "Senior Software Engineer",
    dates: "November 2021–February 2024",
    summary: [
      "I worked on Brave Wallet across the browser, backend and blockchain layers as it grew to more than 10 million active users.",
      "I helped deliver Solana support, the NFT gallery, Filecoin, market-data integrations and fiat on-ramps through Ramp, Sardine, Transak and Wyre. I also designed and improved backend APIs used by millions of clients.",
      "The job involved a lot of cross-functional trade-offs between product, privacy, security, browser constraints, performance and delivery speed.",
    ],
  },
  {
    company: "Fitts",
    role: "Senior Software Engineer and Team Lead",
    dates: "March 2020–February 2022",
    summary: [
      "I led and mentored a team of ten engineers while remaining hands-on with system architecture and delivery.",
      "We improved application performance, strengthened code and architecture reviews, automated deployments with Azure DevOps and GitHub Actions and introduced working practices that reduced production issues.",
    ],
  },
  {
    company: "Humanitec",
    role: "Senior Software Developer",
    dates: "March 2019–February 2020",
    summary: [
      "I built Angular and React applications for enterprise developer platforms and contributed to a micro-frontend architecture.",
      "I also mentored junior developers and helped improve implementation and review practices across the team.",
    ],
  },
  {
    company: "BBC",
    role: "Software Engineer",
    dates: "March 2018–March 2019",
    summary: [
      "I built interactive news applications and data visualisations using React, D3.js and Chart.js.",
      "I also worked on frontend build and deployment tooling with Webpack and Babel, making releases less painful for the teams shipping those experiences.",
    ],
  },
  {
    company: "Transparency International",
    role: "Software Developer",
    dates: "June 2016–February 2018",
    summary: [
      "I built secure anti-corruption reporting tools with Node.js and Angular, as well as cross-platform mobile applications that reached more than 50,000 users.",
      "It was mission-driven work where accountability, privacy and user trust had direct consequences for the people using the software.",
    ],
  },
  {
    company: "Alternate Limited",
    role: "SharePoint and Web Developer",
    dates: "September 2014–May 2016",
    summary: [
      "I built document-management and collaboration tools on SharePoint and trained more than 100 client users on the workflows we delivered.",
      "This was where I first learned that software is not finished when it ships. People still need to understand it, trust it and fit it into the way they already work.",
    ],
  },
];
