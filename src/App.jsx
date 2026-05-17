/* STREAMING_CHUNK:Setting up imports and initial mock data... */
import React, { useState, useEffect, useContext, createContext, useMemo } from 'react';
import { 
  Home, 
  Users, 
  PieChart, 
  Plus, 
  Settings, 
  LogOut, 
  ChevronRight, 
  Receipt,
  CreditCard,
  UserPlus,
  CheckCircle2,
  X,
  AlertCircle,
  Briefcase,
  Coffee,
  Heart
} from 'lucide-react';
import { supabase } from './supabaseClient';
// --- UTILITIES ---

// Use built-in crypto to generate standard database-friendly UUIDs
const generateId = () => crypto.randomUUID(); 
const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
const round2 = (num) => Math.round(num * 100) / 100;

// --- DEBT SIMPLIFICATION ALGORITHM ---

/* STREAMING_CHUNK:Implementing Debt Simplification Algorithm... */
const calculateBalances = (expenses, groupId = null) => {
  const balances = {}; // { userId: netAmount }
  
  const filteredExpenses = groupId 
    ? expenses.filter(e => e.groupId === groupId)
    : expenses;

  // 1. Calculate net balances
  filteredExpenses.forEach(expense => {
    // Payer gets credit
    balances[expense.paidBy] = (balances[expense.paidBy] || 0) + expense.amount;
    
    // Splitters get debit
    Object.entries(expense.splitDetails).forEach(([userId, shareAmount]) => {
      balances[userId] = (balances[userId] || 0) - shareAmount;
    });
  });

  // Clean up floating point tiny errors
  Object.keys(balances).forEach(userId => {
    balances[userId] = round2(balances[userId]);
    if (Math.abs(balances[userId]) < 0.01) {
      balances[userId] = 0;
    }
  });

  return balances;
};

const simplifyDebts = (balances) => {
  let debtors = [];
  let creditors = [];
  
  for (const [userId, amount] of Object.entries(balances)) {
    if (amount < 0) debtors.push({ userId, amount: Math.abs(amount) });
    else if (amount > 0) creditors.push({ userId, amount });
  }
  
  // Sort descending by amount to minimize transactions
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;
  
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    
    const amount = round2(Math.min(debtor.amount, creditor.amount));
    
    if (amount > 0) {
      transactions.push({ from: debtor.userId, to: creditor.userId, amount });
    }
    
    debtor.amount = round2(debtor.amount - amount);
    creditor.amount = round2(creditor.amount - amount);
    
    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }
  
  return transactions;
};


// --- INITIAL STATE & MOCK DATA ---

/* STREAMING_CHUNK:Configuring default state and Context... */
// Updated to use valid UUIDs for PostgreSQL compatibility
const defaultUsers = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alex (You)', email: 'alex@example.com', avatar: 'https://i.pravatar.cc/150?u=1' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Sarah', email: 'sarah@example.com', avatar: 'https://i.pravatar.cc/150?u=2' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Mike', email: 'mike@example.com', avatar: 'https://i.pravatar.cc/150?u=3' },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Emma', email: 'emma@example.com', avatar: 'https://i.pravatar.cc/150?u=4' }
];

const defaultGroups = [];
const defaultExpenses = [];

// --- CONTEXT ---

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [users, setUsers] = useState(defaultUsers);
  const [groups, setGroups] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const currentUser = users[0];

  // 1. FETCH & REAL-TIME SYNC
  const fetchCloudData = async () => {
    const { data: usersData } = await supabase.from('users').select('*');
    const { data: groupsData } = await supabase.from('groups').select('*');
    const { data: expensesData } = await supabase.from('expenses').select('*');

    if (usersData?.length > 0) setUsers(usersData);
    if (groupsData) setGroups(groupsData);
    if (expensesData) setExpenses(expensesData);
  };

  useEffect(() => {
    // Initial fetch on load
    fetchCloudData();

    // The Magic: Listen to the cloud for ANY changes in expenses or groups
    const subscription = supabase
      .channel('public:sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
        fetchCloudData(); // Re-fetch silently when someone else adds an expense!
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => {
        fetchCloudData(); // Re-fetch silently when someone modifies a group!
      })
      .subscribe();

    // Cleanup listener when app closes
    return () => {
      supabase.removeChannel(subscription);
    };
  }, []); 

  // 2. ADD USER BY EMAIL
  const inviteUserByEmail = async (email, name) => {
    // Check if user already exists
    const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).single();
    
    if (existingUser) return existingUser.id; // Return their existing ID

    // If new, create them
    const newUser = { id: crypto.randomUUID(), name, email, avatar: '' };
    const { error } = await supabase.from('users').insert([newUser]);
    
    if (!error) {
      setUsers([...users, newUser]);
      return newUser.id;
    }
    return null;
  };

  // 3. REMOVE MEMBER SAFELY
  const removeMember = async (groupId, userId) => {
    // Math Check: Is their balance zero?
    const groupBalances = calculateBalances(expenses, groupId);
    const userBalance = groupBalances[userId] || 0;
    
    if (Math.abs(userBalance) > 0.01) {
      alert(`Cannot remove user! They must settle their balance of ${formatCurrency(Math.abs(userBalance))} first.`);
      return;
    }

    // Safe to remove
    const group = groups.find(g => g.id === groupId);
    const updatedMembers = group.members.filter(id => id !== userId);
    
    // Update local UI immediately
    setGroups(groups.map(g => g.id === groupId ? { ...g, members: updatedMembers } : g));
    
    // Update cloud
    await supabase.from('groups').update({ members: updatedMembers }).eq('id', groupId);
  };
  // 4. ADD MEMBER TO EXISTING GROUP (NEW FUNCTION)
  const addMemberToGroup = async (groupId, userId) => {
    const group = groups.find(g => g.id === groupId);
    if (!group || group.members.includes(userId)) return;

    const updatedMembers = [...group.members, userId];
    
    // Update local UI immediately
    setGroups(groups.map(g => g.id === groupId ? { ...g, members: updatedMembers } : g));
    
    // Update cloud instantly
    await supabase.from('groups').update({ members: updatedMembers }).eq('id', groupId);
  };

  // Standard Database Actions
  const addExpense = async (expense) => {
    setExpenses([expense, ...expenses]);
    await supabase.from('expenses').insert([expense]); 
  };

  const addGroup = async (group) => {
    setGroups([...groups, group]);
    await supabase.from('groups').insert([group]); 
  };

  const deleteExpense = async (id) => {
    setExpenses(expenses.filter(e => e.id !== id));
    await supabase.from('expenses').delete().eq('id', id); 
  };

  return (
      <AppContext.Provider value={{ 
        users, setUsers, 
        groups, addGroup, 
        expenses, addExpense, deleteExpense, 
        currentUser,
        inviteUserByEmail,  
        removeMember,      // <--- Added the comma right here!
        addMemberToGroup
      }}>
        {children}
      </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);

// --- SHARED UI COMPONENTS ---

/* STREAMING_CHUNK:Building shared UI components (Modals, Inputs)... */
const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

const Avatar = ({ user, size = 'md' }) => {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-lg' };
  return (
    <div className={`${sizes[size]} rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold overflow-hidden shrink-0 ring-2 ring-white shadow-sm`}>
      {user.avatar ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" /> : user.name.charAt(0)}
    </div>
  );
};

// --- FEATURE: ADD EXPENSE MODAL ---

/* STREAMING_CHUNK:Implementing the Add Expense Modal & Split Engine... */
const AddExpenseModal = ({ isOpen, onClose, groupId = null }) => {
  const { groups, users, currentUser, addExpense } = useApp();
  
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(groupId || (groups[0]?.id || ''));
  const [paidBy, setPaidBy] = useState(currentUser.id);
  const [splitMethod, setSplitMethod] = useState('equal'); // equal, exact, percentage
  const [customSplits, setCustomSplits] = useState({}); // { userId: amount/percentage }
  const [error, setError] = useState('');

  const activeGroup = groups.find(g => g.id === selectedGroupId);
  const groupMembers = users.filter(u => activeGroup?.members.includes(u.id));

  useEffect(() => {
    if (activeGroup && splitMethod !== 'equal') {
      const initialSplits = {};
      groupMembers.forEach(m => initialSplits[m.id] = '');
      setCustomSplits(initialSplits);
    }
  }, [splitMethod, selectedGroupId]);

  const handleCustomSplitChange = (userId, value) => {
    setCustomSplits(prev => ({ ...prev, [userId]: value }));
  };

  const handleSave = () => {
    setError('');
    if (!description || !amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid description and amount.');
      return;
    }

    const numAmount = parseFloat(amount);
    let finalSplitDetails = {};

    if (splitMethod === 'equal') {
      const splitAmount = round2(numAmount / groupMembers.length);
      let totalAssigned = 0;
      
      groupMembers.forEach((m, i) => {
        // Adjust the last person to fix rounding errors (e.g. 100 / 3)
        if (i === groupMembers.length - 1) {
          finalSplitDetails[m.id] = round2(numAmount - totalAssigned);
        } else {
          finalSplitDetails[m.id] = splitAmount;
          totalAssigned += splitAmount;
        }
      });
    } else if (splitMethod === 'exact') {
      let totalSlices = 0;
      groupMembers.forEach(m => {
        const val = parseFloat(customSplits[m.id]) || 0;
        finalSplitDetails[m.id] = val;
        totalSlices += val;
      });
      if (Math.abs(totalSlices - numAmount) > 0.01) {
        setError(`Exact amounts must sum to ${formatCurrency(numAmount)}. Current sum: ${formatCurrency(totalSlices)}`);
        return;
      }
    } else if (splitMethod === 'percentage') {
      let totalPercent = 0;
      let totalAssigned = 0;
      
      groupMembers.forEach((m, i) => {
        const percent = parseFloat(customSplits[m.id]) || 0;
        totalPercent += percent;
        
        if (i === groupMembers.length - 1) {
          finalSplitDetails[m.id] = round2(numAmount - totalAssigned);
        } else {
          const splitAmt = round2((numAmount * percent) / 100);
          finalSplitDetails[m.id] = splitAmt;
          totalAssigned += splitAmt;
        }
      });
      
      if (Math.abs(totalPercent - 100) > 0.01) {
        setError(`Percentages must sum to 100%. Current sum: ${totalPercent}%`);
        return;
      }
    }

    const newExpense = {
      id: generateId(),
      groupId: selectedGroupId,
      description,
      amount: numAmount,
      paidBy,
      splitMethod,
      splitDetails: finalSplitDetails,
      date: new Date().toISOString(),
      category: 'General'
    };

    addExpense(newExpense);
    onClose();
    // Reset form
    setDescription('');
    setAmount('');
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add an expense">
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        
        <div className="flex gap-4">
          <div className="w-16 h-16 bg-emerald-100 rounded-lg flex items-center justify-center border border-emerald-200">
            <Receipt className="text-emerald-600" size={28} />
          </div>
          <div className="flex-1 space-y-2">
            <input 
              type="text" 
              placeholder="Enter a description" 
              className="w-full text-lg font-semibold border-b-2 border-gray-200 focus:border-emerald-500 outline-none px-1 py-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center text-2xl font-bold">
              <span className="text-gray-400 mr-1">$</span>
              <input 
                type="number" 
                placeholder="0.00" 
                className="w-full border-b-2 border-gray-200 focus:border-emerald-500 outline-none px-1 py-1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Group</label>
            <select 
              className="w-full p-2 border rounded-lg bg-gray-50 mt-1"
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Paid By</label>
            <select 
              className="w-full p-2 border rounded-lg bg-gray-50 mt-1"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
            >
              {groupMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t">
          <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Split Method</label>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            {['equal', 'exact', 'percentage'].map(method => (
              <button
                key={method}
                onClick={() => setSplitMethod(method)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${splitMethod === method ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Split Inputs */}
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {groupMembers.map(member => (
            <div key={member.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
              <div className="flex items-center gap-2">
                <Avatar user={member} size="sm" />
                <span className="text-sm font-medium">{member.id === currentUser.id ? 'You' : member.name}</span>
              </div>
              
              {splitMethod === 'equal' ? (
                <span className="text-sm font-semibold text-gray-600">
                  {amount ? formatCurrency(parseFloat(amount) / groupMembers.length) : '$0.00'}
                </span>
              ) : (
                <div className="flex items-center gap-1 w-24">
                  {splitMethod === 'exact' && <span className="text-gray-400">$</span>}
                  <input
                    type="number"
                    className="w-full p-1.5 border rounded-md text-right text-sm"
                    placeholder="0"
                    value={customSplits[member.id] || ''}
                    onChange={(e) => handleCustomSplitChange(member.id, e.target.value)}
                  />
                  {splitMethod === 'percentage' && <span className="text-gray-400">%</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        <button 
          onClick={handleSave}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm"
        >
          Save Expense
        </button>
      </div>
    </Modal>
  );
};

// --- FEATURE: SETTLE UP MODAL ---

/* STREAMING_CHUNK:Implementing Settle Up feature... */
const SettleUpModal = ({ isOpen, onClose, groupId = null }) => {
  const { users, currentUser, addExpense, expenses } = useApp();
  const [payeeId, setPayeeId] = useState('');
  const [amount, setAmount] = useState('');

  // Find all people currentUser owes money to
  const balances = calculateBalances(expenses, groupId);
  const debts = simplifyDebts(balances);
  const myDebts = debts.filter(d => d.from === currentUser.id);

  useEffect(() => {
    if (myDebts.length > 0 && !payeeId) {
      setPayeeId(myDebts[0].to);
      setAmount(myDebts[0].amount.toString());
    }
  }, [myDebts, payeeId]);

  const handleSettle = () => {
    if (!payeeId || parseFloat(amount) <= 0) return;
    
    // A settlement is an expense where I pay someone, for their entire benefit.
    const settlement = {
      id: generateId(),
      groupId: groupId || 'non-group', // Simplification for demo
      description: 'Payment',
      amount: parseFloat(amount),
      paidBy: currentUser.id,
      splitMethod: 'exact',
      splitDetails: { [payeeId]: parseFloat(amount) },
      date: new Date().toISOString(),
      category: 'Payment',
      isPayment: true
    };
    
    addExpense(settlement);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settle up">
      {myDebts.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle2 className="mx-auto text-emerald-500 mb-3" size={48} />
          <h3 className="text-lg font-bold text-gray-800">You are all settled up!</h3>
          <p className="text-gray-500 text-sm mt-1">You don't owe anyone right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-4 py-4">
            <Avatar user={currentUser} size="lg" />
            <ChevronRight className="text-gray-300" size={24} />
            <Avatar user={users.find(u => u.id === payeeId) || users[1]} size="lg" />
          </div>
          
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Recipient</label>
            <select 
              className="w-full p-2 border rounded-lg bg-gray-50 mt-1"
              value={payeeId}
              onChange={(e) => {
                setPayeeId(e.target.value);
                const debt = myDebts.find(d => d.to === e.target.value);
                if (debt) setAmount(debt.amount.toString());
              }}
            >
              {myDebts.map(debt => {
                const user = users.find(u => u.id === debt.to);
                return <option key={debt.to} value={debt.to}>{user?.name}</option>
              })}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Amount</label>
            <div className="flex items-center text-2xl font-bold mt-1">
              <span className="text-gray-400 mr-2">$</span>
              <input 
                type="number" 
                className="w-full border-b-2 border-gray-200 focus:border-emerald-500 outline-none py-1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <button 
            onClick={handleSettle}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm mt-4"
          >
            Record Payment
          </button>
        </div>
      )}
    </Modal>
  );
};

const AddFriendModal = ({ isOpen, onClose }) => {
  const { inviteUserByEmail } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');

  const handleAdd = async () => {
    if (!name || !email) return;
    setStatus('Adding...');
    
    const id = await inviteUserByEmail(email, name);
    
    if (id) {
      setStatus('Success! Friend added.');
      setTimeout(() => {
        onClose();
        setName('');
        setEmail('');
        setStatus('');
      }, 1500);
    } else {
      setStatus('Error adding friend.');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add a Friend">
      <div className="space-y-4">
        {status && <p className="text-sm font-bold text-emerald-600">{status}</p>}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Friend's Name</label>
          <input type="text" placeholder="E.g., John Doe" className="w-full p-2 border-b-2 border-gray-200 focus:border-emerald-500 outline-none mt-1 text-lg" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Email Address</label>
          <input type="email" placeholder="john@example.com" className="w-full p-2 border-b-2 border-gray-200 focus:border-emerald-500 outline-none mt-1 text-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button onClick={handleAdd} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm">
          Add to Contacts
        </button>
      </div>
    </Modal>
  );
};
// --- FEATURE: CREATE GROUP MODAL ---

/* STREAMING_CHUNK:Implementing Create Group Modal... */
const CreateGroupModal = ({ isOpen, onClose }) => {
  const { addGroup, users, currentUser } = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState('trip');
  const [selectedMembers, setSelectedMembers] = useState([currentUser.id]);

  const handleCreate = () => {
    if (!name) return;
    const newGroup = {
      id: generateId(),
      name,
      type,
      members: selectedMembers
    };
    addGroup(newGroup);
    onClose();
  };

  const toggleMember = (id) => {
    if (id === currentUser.id) return; // Cannot remove self
    if (selectedMembers.includes(id)) {
      setSelectedMembers(selectedMembers.filter(m => m !== id));
    } else {
      setSelectedMembers([...selectedMembers, id]);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create a group">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Group Name</label>
          <input 
            type="text" 
            placeholder="E.g., Miami Trip" 
            className="w-full p-2 border-b-2 border-gray-200 focus:border-emerald-500 outline-none mt-1 text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Group Type</label>
          <div className="flex gap-2">
            {[
              { id: 'trip', icon: <Briefcase size={16} />, label: 'Trip' },
              { id: 'home', icon: <Home size={16} />, label: 'Home' },
              { id: 'couple', icon: <Heart size={16} />, label: 'Couple' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-lg border transition-colors ${type === t.id ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {t.icon} <span className="text-sm font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Members</label>
          <div className="space-y-2 border rounded-lg p-2 max-h-48 overflow-y-auto">
            {users.map(user => (
              <div 
                key={user.id} 
                onClick={() => toggleMember(user.id)}
                className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${selectedMembers.includes(user.id) ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar user={user} size="sm" />
                  <span className="text-sm font-medium">{user.name} {user.id === currentUser.id && '(You)'}</span>
                </div>
                {selectedMembers.includes(user.id) && <CheckCircle2 size={18} className="text-emerald-500" />}
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={handleCreate}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm"
        >
          Save Group
        </button>
      </div>
    </Modal>
  );
};


// --- VIEWS ---

/* STREAMING_CHUNK:Building the Group Details View... */
const GroupView = ({ group }) => {
  // We added addMemberToGroup here!
  const { expenses, users, currentUser, deleteExpense, removeMember, addMemberToGroup } = useApp();
  const [activeTab, setActiveTab] = useState('expenses');
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isSettleUpOpen, setIsSettleUpOpen] = useState(false);
  
  // State for the new member dropdown
  const [newMemberId, setNewMemberId] = useState('');

  const groupExpenses = expenses.filter(e => e.groupId === group.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const balances = useMemo(() => calculateBalances(expenses, group.id), [expenses, group.id]);
  const debts = useMemo(() => simplifyDebts(balances), [balances]);
  const myBalance = balances[currentUser.id] || 0;

  // Find all friends who are NOT currently in this group
  const nonMembers = users.filter(u => !group.members.includes(u.id));

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 bg-gray-50/50">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><Users size={14} /> {group.members.length} members</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setIsSettleUpOpen(true)} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm">Settle up</button>
            <button onClick={() => setIsAddExpenseOpen(true)} className="px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg text-sm font-medium flex items-center gap-1 shadow-sm"><Plus size={16} /> Add expense</button>
          </div>
        </div>
        <div className="flex gap-6">
          <button onClick={() => setActiveTab('expenses')} className={`pb-3 text-sm font-medium border-b-2 ${activeTab === 'expenses' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500'}`}>Expenses</button>
          <button onClick={() => setActiveTab('balances')} className={`pb-3 text-sm font-medium border-b-2 ${activeTab === 'balances' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500'}`}>Balances</button>
          <button onClick={() => setActiveTab('members')} className={`pb-3 text-sm font-medium border-b-2 ${activeTab === 'members' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500'}`}>Members</button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'expenses' && (
           /* Expenses layout... */
          <div className="space-y-0">
            {groupExpenses.length === 0 ? (
              <div className="text-center py-12"><Receipt className="mx-auto text-gray-300 mb-3" size={48} /><h3 className="text-lg font-medium text-gray-900">No expenses yet</h3></div>
            ) : (
              groupExpenses.map(expense => {
                const payer = users.find(u => u.id === expense.paidBy);
                const isPayer = expense.paidBy === currentUser.id;
                let userImpact = isPayer ? expense.amount - (expense.splitDetails[currentUser.id] || 0) : -(expense.splitDetails[currentUser.id] || 0);
                const date = new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                return (
                  <div key={expense.id} className="group flex items-center justify-between py-4 border-b border-gray-100 hover:bg-gray-50 px-2 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-500">
                        <span className="text-xs uppercase font-bold text-gray-400">{date.split(' ')[0]}</span>
                        <span className="text-lg font-bold text-gray-700 leading-none">{date.split(' ')[1]}</span>
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 flex items-center gap-2">{expense.description}{expense.isPayment && <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full">Payment</span>}</h4>
                        <p className="text-sm text-gray-500">{isPayer ? 'You' : payer?.name} paid <span className="font-medium text-gray-700">{formatCurrency(expense.amount)}</span></p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {userImpact > 0 ? <p className="text-sm font-bold text-emerald-500">{formatCurrency(userImpact)}</p> : userImpact < 0 ? <p className="text-sm font-bold text-orange-500">{formatCurrency(Math.abs(userImpact))}</p> : <p className="text-sm text-gray-400">not involved</p>}
                      </div>
                      <button onClick={() => deleteExpense(expense.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600"><X size={16} /></button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {activeTab === 'balances' && (
           /* Balances layout... */
          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              {myBalance > 0 ? <p className="text-lg font-medium text-emerald-600">You are owed <span className="font-bold">{formatCurrency(myBalance)}</span> total.</p> : myBalance < 0 ? <p className="text-lg font-medium text-orange-600">You owe <span className="font-bold">{formatCurrency(Math.abs(myBalance))}</span> total.</p> : <p className="text-lg font-medium text-gray-600">You are settled up!</p>}
            </div>
            <div className="space-y-3">
              {debts.map((debt, idx) => {
                const f = users.find(u => u.id === debt.from);
                const t = users.find(u => u.id === debt.to);
                return (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-xl shadow-sm bg-white">
                    <span className="font-medium text-gray-700">{f?.id === currentUser.id ? 'You' : f?.name} owes {t?.id === currentUser.id ? 'You' : t?.name}</span>
                    <span className="font-bold text-gray-900">{formatCurrency(debt.amount)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Manage Members</h3>
            
            {/* The existing list of members */}
            {group.members.map(memberId => {
              const member = users.find(u => u.id === memberId);
              const isMe = memberId === currentUser.id;
              
              return (
                <div key={memberId} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-white shadow-sm">
                  <div className="flex items-center gap-3">
                    <Avatar user={member || {name: 'Unknown'}} size="sm" />
                    <span className="font-medium text-gray-800">{member?.name} {isMe && '(You)'}</span>
                  </div>
                  {!isMe && (
                    <button 
                      onClick={() => removeMember(group.id, memberId)} 
                      className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            })}

            {/* NEW UI: Add a Friend to Group Dropdown */}
            {nonMembers.length > 0 && (
              <div className="mt-8 pt-6 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Add to Group</h4>
                <div className="flex gap-3">
                  <select
                    className="flex-1 p-2.5 border border-gray-200 rounded-lg bg-gray-50 outline-none focus:border-emerald-500 text-sm font-medium text-gray-700"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                  >
                    <option value="">Select a friend to add...</option>
                    {nonMembers.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button 
                    disabled={!newMemberId}
                    onClick={() => {
                      if (newMemberId) {
                        addMemberToGroup(group.id, newMemberId);
                        setNewMemberId(''); // Reset dropdown
                      }
                    }}
                    className="px-5 py-2.5 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AddExpenseModal isOpen={isAddExpenseOpen} onClose={() => setIsAddExpenseOpen(false)} groupId={group.id} />
      <SettleUpModal isOpen={isSettleUpOpen} onClose={() => setIsSettleUpOpen(false)} groupId={group.id} />
    </div>
  );
};


/* STREAMING_CHUNK:Building the Main Dashboard View... */
const DashboardOverview = () => {
  const { expenses, currentUser, users } = useApp();
  
  const balances = useMemo(() => calculateBalances(expenses), [expenses]);
  const debts = useMemo(() => simplifyDebts(balances), [balances]);
  
  let totalOwed = 0;
  let totalOwe = 0;

  debts.forEach(d => {
    if (d.from === currentUser.id) totalOwe += d.amount;
    if (d.to === currentUser.id) totalOwed += d.amount;
  });

  const totalBalance = totalOwed - totalOwe;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Total Balance</p>
          <p className={`text-3xl font-bold ${totalBalance >= 0 ? 'text-emerald-500' : 'text-orange-500'}`}>
            {totalBalance > 0 ? '+' : ''}{formatCurrency(totalBalance)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">You Owe</p>
          <p className="text-3xl font-bold text-orange-500">{formatCurrency(totalOwe)}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">You are Owed</p>
          <p className="text-3xl font-bold text-emerald-500">{formatCurrency(totalOwed)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-b pb-2">You owe</h2>
          <div className="space-y-4">
            {debts.filter(d => d.from === currentUser.id).length === 0 ? (
              <p className="text-gray-500 text-sm">You do not owe anything.</p>
            ) : (
              debts.filter(d => d.from === currentUser.id).map((d, i) => {
                const toUser = users.find(u => u.id === d.to);
                return (
                  <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <Avatar user={toUser} size="md" />
                      <span className="font-medium text-gray-800">{toUser?.name}</span>
                    </div>
                    <span className="font-bold text-orange-500">{formatCurrency(d.amount)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-b pb-2">You are owed</h2>
          <div className="space-y-4">
            {debts.filter(d => d.to === currentUser.id).length === 0 ? (
              <p className="text-gray-500 text-sm">You are not owed anything.</p>
            ) : (
              debts.filter(d => d.to === currentUser.id).map((d, i) => {
                const fromUser = users.find(u => u.id === d.from);
                return (
                  <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <Avatar user={fromUser} size="md" />
                      <span className="font-medium text-gray-800">{fromUser?.name}</span>
                    </div>
                    <span className="font-bold text-emerald-500">{formatCurrency(d.amount)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


// --- MAIN APP LAYOUT & SIDEBAR ---

/* STREAMING_CHUNK:Assembling the main application layout and sidebar... */
const Layout = () => {
  const { groups, currentUser } = useApp();
  const [activeView, setActiveView] = useState({ type: 'dashboard' });
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false); // NEW STATE
  
  const activeGroup = activeView.type === 'group' ? groups.find(g => g.id === activeView.id) : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-gray-900">
      <div className="w-full md:w-64 bg-white border-r border-gray-200 flex flex-col p-4 space-y-6">
        <div className="flex items-center gap-2 text-emerald-600 font-black text-xl px-2"><PieChart size={24} /> SplitSync</div>
        
        <div className="space-y-1">
          <button onClick={() => setActiveView({ type: 'dashboard' })} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium ${activeView.type === 'dashboard' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'}`}><Home size={18} /> Dashboard</button>
          
          {/* New Add Friend Button */}
          <button onClick={() => setIsAddFriendOpen(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <UserPlus size={18} /> Add new friend
          </button>
          
          <button onClick={() => setIsAddExpenseOpen(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100"><Plus size={18} /> Add expense</button>
        </div>
        
        <div>
          <div className="flex items-center justify-between px-3 mb-2"><span className="text-xs font-bold text-gray-400 uppercase">Groups</span><button onClick={() => setIsCreateGroupOpen(true)} className="text-emerald-500"><Plus size={16} /></button></div>
          <div className="space-y-1">
            {groups.map(g => <button key={g.id} onClick={() => setActiveView({ type: 'group', id: g.id })} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium ${activeView.type === 'group' && activeView.id === g.id ? 'bg-gray-100 text-gray-950' : 'text-gray-600 hover:bg-gray-50'}`}><Users size={16} /> <span className="truncate">{g.name}</span></button>)}
          </div>
        </div>
        
        <div className="mt-auto border-t pt-4 flex items-center gap-3 px-2">
          <Avatar user={currentUser} size="md" />
          <div><p className="text-sm font-bold text-gray-900">{currentUser?.name}</p></div>
        </div>
      </div>
      
      <div className="flex-1 p-6 md:p-8 overflow-y-auto">
        {activeView.type === 'dashboard' ? <DashboardOverview /> : activeGroup ? <GroupView group={activeGroup} /> : <div className="text-center py-12">Not Found</div>}
      </div>

      <AddExpenseModal isOpen={isAddExpenseOpen} onClose={() => setIsAddExpenseOpen(false)} />
      <CreateGroupModal isOpen={isCreateGroupOpen} onClose={() => setIsCreateGroupOpen(false)} />
      
      {/* Rendering the new modal */}
      <AddFriendModal isOpen={isAddFriendOpen} onClose={() => setIsAddFriendOpen(false)} />
    </div>
  );
};

/* STREAMING_CHUNK:Final App wrapper export... */
export default function App() {
  return (
    <AppProvider>
      <Layout />
    </AppProvider>
  );
}
