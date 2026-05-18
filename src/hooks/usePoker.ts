import { useState } from 'react';
import { Table } from '../types';

export function usePoker() {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTables = async () => {
    setLoading(true);
    // TODO: appel WebSocket ou API
    setLoading(false);
  };

  const joinTable = (tableId: string) => {
    // TODO: rejoindre une table
    console.log('Joining table:', tableId);
  };

  return { tables, loading, fetchTables, joinTable };
}
