import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export const MAX_SERVER_PLAYERS = 30;

export async function findAvailableServer(collectionName: string = 'arenaPlayers', category?: string): Promise<string> {
  let serverIndex = 1;
  
  while (true) {
    let prefix = '';
    if (collectionName === 'wagerPlayers') {
      prefix = category ? `${category}_` : 'wager_';
    } else {
      prefix = 'server_';
    }
    
    const serverId = `${prefix}${serverIndex}`;
    const sixtySecondsAgo = Date.now() - 60000;
    const q = query(
      collection(db, collectionName), 
      where('serverId', '==', serverId),
      where('isAlive', '==', true),
      where('lastUpdate', '>', sixtySecondsAgo)
    );
    
    const snapshot = await getDocs(q);
    if (snapshot.size < MAX_SERVER_PLAYERS) {
      return serverId;
    }
    
    serverIndex++;
    // Safety break
    if (serverIndex > 100) return 'server_id_overflow';
  }
}
