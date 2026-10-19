import type { Metadata } from "next";
import FreeflowDashboardPage from "./FreeflowDashboardPage";

export const metadata: Metadata = {
  title: "FreeFlow Models & Proxies | OmniRoute",
  description: "Manage 35 free models, egress proxy relays, and Cline multi-account rotation",
};

export default function Page() {
  return <FreeflowDashboardPage />;
}
