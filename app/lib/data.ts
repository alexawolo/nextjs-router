import postgres from 'postgres';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';
import { supabase } from './supabase-client';


export async function fetchRevenue() {
  try {
    // We artificially delay a response for demo purposes.
    // Don't do this in production :)
    console.log('Fetching revenue data...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { data, error } = await supabase
      .from('revenue')
      .select('*');

    if (error) {
      console.error('Database Error:', error);
      throw new Error('Failed to fetch revenue data.');
    }

    console.log('Data fetch completed after 3 seconds.');
    console.log('RAW DATA:', JSON.stringify(data, null, 2));

    return data;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchLatestInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, amount, date, customer_id(id, name, image_url, email)')
    .order('date', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  }

  const seen = new Set();
  const latestByCustomer = [];
  for (const invoice of data) {
    const customer = Array.isArray(invoice.customer_id) ? invoice.customer_id[0] : invoice.customer_id;
    const customerId = customer?.id;
    if (customerId && !seen.has(customerId)) {
      latestByCustomer.push(invoice);
      seen.add(customerId);
    }
  }

  const latestInvoices = latestByCustomer.map((invoice) => {
    const customer = Array.isArray(invoice.customer_id) ? invoice.customer_id[0] : invoice.customer_id;
    return {
      id: invoice.id,
      amount: formatCurrency(invoice.amount),
      name: customer?.name ?? '',
      image_url: customer?.image_url ?? '',
      email: customer?.email ?? '',
    };
  });
  
  console.log('latestInvoices:', latestInvoices);
  
  return latestInvoices;
}

export async function fetchCardData() {
  const { data, error } = await supabase
    .from('invoices')
    .select('amount, status');

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }

  let totalPaidInvoices = 0;
  let totalPendingInvoices = 0;
  let numberOfInvoices = 0;

  if (data) {
    numberOfInvoices = data.length;
    for (const invoice of data) {
      if (invoice.status === 'paid') {
        totalPaidInvoices += invoice.amount;
      } else if (invoice.status === 'pending') {
        totalPendingInvoices += invoice.amount;
      }
    }
  }

  const { count: numberOfCustomers, error: customerError } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true });

  if (customerError) {
    console.error('Database Error:', customerError);
    throw new Error('Failed to fetch customer count.');
  }

  return {
    totalPaidInvoices,
    totalPendingInvoices,
    numberOfInvoices,
    numberOfCustomers: numberOfCustomers ?? 0,
  };
}

const ITEMS_PER_PAGE = 6;

//Promise<InvoiceWithCustomer[]>
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number
) {
  const from = (currentPage - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE - 1;

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id,
      amount,
      date,
      status,
      customers (
        name,
        email,
        image_url
      )
    `)
    .ilike('customers.name', `%${query}%`)
    .order('date', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }

  // Flatten and filter further in JS if needed
  return (data ?? [])
    .map((invoice) => {
      const customer = Array.isArray(invoice.customers)
        ? invoice.customers[0]
        : invoice.customers;
      return {
        id: invoice.id,
        amount: invoice.amount,
        date: invoice.date,
        status: invoice.status,
        name: customer?.name ?? '',
        email: customer?.email ?? '',
        image_url: customer?.image_url ?? '',
      };
    })
    .filter((invoice) =>
      // Further filter in JS for other fields if needed
      invoice.email.toLowerCase().includes(query.toLowerCase()) ||
      invoice.amount.toString().includes(query) ||
      invoice.date.toString().includes(query) ||
      invoice.status.toLowerCase().includes(query) ||
      invoice.name.toLowerCase().includes(query)
    );
}

export async function fetchInvoicesPages(query: string) {
  // Build the filter for the query
  let filter = supabase
    .from('invoices')
    .select('id, amount, date, status, customers(name, email, image_url)', { count: 'exact', head: true })
    .ilike('customers.name', `%${query}%`);

  // You can add more .or() conditions if you want to match other fields
  // But Supabase's .or() only works on top-level columns, not joined columns
  // For more complex filters, consider a Postgres view or function

  const { count, error } = await filter;

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }

  const totalPages = Math.ceil((count ?? 0) / ITEMS_PER_PAGE);
  return totalPages;
}

export async function fetchInvoiceById(id: string) {
  try {
    const { data } = await supabase
      .from('invoices')
      .select('id, customer_id, amount, status')
      .eq('id', id)
      .single();

    if (!data) {
      return null;
    }

    return {
      ...data,
      amount: data.amount / 100,
    };
  } catch (error) {
    console.error('Error fetching invoice:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch all customers.');
  }

  return data;
}

export async function fetchFilteredCustomers(query: string) {
  // Fetch customers matching the query
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, email, image_url')
    .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
    .order('name', { ascending: true });

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch customer table.');
  }

  // Fetch all invoices (or only those for the filtered customers)
  const customerIds = customers.map(c => c.id);
  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('customer_id, amount, status')
    .in('customer_id', customerIds);

  if (invoiceError) {
    console.error('Database Error:', invoiceError);
    throw new Error('Failed to fetch invoices for customers.');
  }

  // Aggregate in JS
  const customerMap = customers.map(customer => {
    const custInvoices = invoices.filter(inv => inv.customer_id === customer.id);
    const total_invoices = custInvoices.length;
    const total_pending = custInvoices.filter(inv => inv.status === 'pending').reduce((sum, inv) => sum + inv.amount, 0);
    const total_paid = custInvoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0);

    return {
      ...customer,
      total_invoices,
      total_pending: formatCurrency(total_pending),
      total_paid: formatCurrency(total_paid),
    };
  });

  return customerMap;
}