import Item from "@/components/pages/Item";

export default function ItemPage({ params }: { params: { key: string } }) {
  const { key } = params;

  return <Item id={key} />;
}
