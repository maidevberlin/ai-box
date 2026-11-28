// The names agents are given, if they have names (the setting `named`, see ENGINE in
// types.ts). Each agent knows only its own: who others are, it learns as people do, by
// being told.
//
// The names are made up. A real name says something of whoever has it (a man, a woman,
// where they are from), and models treat people differently by their names: a run would
// study that too, without meaning to. These say nothing, and none is a word or a name in a
// language we know of. Change them with care.

const NAMES = ['Avet', 'Belu', 'Cobu', 'Dask', 'Efin', 'Gufa', 'Hesk', 'Ibet', 'Juvo', 'Kesu', 'Lesk',
               'Mirt', 'Nobe', 'Omet', 'Pell', 'Quen', 'Ruvi', 'Sivo', 'Tobu', 'Ulen', 'Vesk', 'Zetu'];

/** Gives names by chance, never one twice in a run. When there are none left, they come again
 *  with a number: "Avet 2". */
export function namer(random: () => number): () => string {
  let left: string[] = [], round = 0;
  return () => {
    if (!left.length) {
      left = [...NAMES];
      round++;
    }
    const [name] = left.splice(Math.floor(random() * left.length), 1);
    return round === 1 ? name! : `${name} ${round}`;
  };
}
