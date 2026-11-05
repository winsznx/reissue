import type { Metadata } from "next";

import { ActivityFeed } from "./activity-feed";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <ActivityFeed />;
}
