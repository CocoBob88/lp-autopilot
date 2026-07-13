import type { Metadata } from "next";
import { PositionDetail } from "@/src/components/position-detail";

export const metadata: Metadata = { title: "Position detail" };

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ owner?: string; chainId?: string }>;
}) {
  const { tokenId } = await params;
  const query = await searchParams;
  return (
    <PositionDetail
      tokenId={tokenId}
      owner={query.owner}
      chainId={Number(query.chainId || 4663)}
    />
  );
}
