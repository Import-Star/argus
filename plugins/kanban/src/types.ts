export interface Card {
  id: string;
  text: string;
}

export interface Column {
  id: string;
  name: string;
  cards: Card[];
}

export interface BoardData {
  version: 1;
  columns: Column[];
}
