'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Users,
  UserCheck,
  Baby,
  Briefcase,
  Handshake,
  CalendarCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Indicadores {
  filiados: { total: number; ativos: number; inativos: number; novosNoMes: number };
  dependentes: { total: number; conjuges: number; filhos: number };
  funcionarios: { total: number };
  prestadores: { total: number };
  eventos: { realizados: number; agendados: number };
  presencas: { total: number };
}

export default function DashboardPage() {
  const { data: ind } = useQuery({
    queryKey: ['indicadores'],
    queryFn: async () => (await api.get<Indicadores>('/dashboard/indicadores')).data,
  });
  const { data: crescimento } = useQuery({
    queryKey: ['crescimento'],
    queryFn: async () => (await api.get('/dashboard/crescimento-filiados')).data,
  });
  const { data: presencas } = useQuery({
    queryKey: ['presencas-evento'],
    queryFn: async () => (await api.get('/dashboard/presencas-por-evento')).data,
  });

  const cards = [
    { label: 'Filiados ativos', valor: ind?.filiados.ativos, sub: `${ind?.filiados.total ?? 0} no total`, icon: UserCheck, cor: 'text-senatepi-800' },
    { label: 'Novos no mês', valor: ind?.filiados.novosNoMes, sub: 'Filiações recentes', icon: Users, cor: 'text-senatepi-600' },
    { label: 'Dependentes', valor: ind?.dependentes.total, sub: `${ind?.dependentes.filhos ?? 0} filhos · ${ind?.dependentes.conjuges ?? 0} cônjuges`, icon: Baby, cor: 'text-senatepi-600' },
    { label: 'Funcionários', valor: ind?.funcionarios.total, sub: 'Equipe interna', icon: Briefcase, cor: 'text-senatepi-800' },
    { label: 'Prestadores', valor: ind?.prestadores.total, sub: 'Contratos ativos', icon: Handshake, cor: 'text-senatepi-600' },
    { label: 'Eventos agendados', valor: ind?.eventos.agendados, sub: `${ind?.eventos.realizados ?? 0} realizados`, icon: CalendarCheck, cor: 'text-senatepi-800' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Visão geral</h2>
        <p className="text-sm text-muted-foreground">Indicadores em tempo real do sindicato</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <CardContent className="flex items-center justify-between p-6">
                  <div>
                    <p className="text-sm text-muted-foreground">{c.label}</p>
                    <p className="mt-1 text-3xl font-bold">{c.valor ?? '—'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
                  </div>
                  <div className="rounded-xl bg-senatepi-50 p-3 dark:bg-senatepi-900/30">
                    <Icon className={`h-7 w-7 ${c.cor}`} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Crescimento de filiados (6 meses)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={crescimento ?? []}>
                <defs>
                  <linearGradient id="verde" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4FA11B" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#4FA11B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="total" stroke="#1B7F0A" fill="url(#verde)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Presenças por evento</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={presencas ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="evento" fontSize={11} tickFormatter={(v: string) => v.slice(0, 12)} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="presencas" fill="#1B7F0A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
