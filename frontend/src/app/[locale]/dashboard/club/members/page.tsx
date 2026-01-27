"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import {
  Club,
  Member,
  createMember,
  getClubs,
  getMembers,
  updateMember,
} from "@/lib/club-admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const memberSchema = z.object({
  club: z.string().min(1, "Club is required"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  date_of_birth: z.string().optional(),
  belt_rank: z.string().optional(),
});

type MemberFormValues = z.infer<typeof memberSchema>;

export default function ClubAdminMembersPage() {
  const t = useTranslations("ClubAdmin");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pageSize = 8;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      club: "",
      first_name: "",
      last_name: "",
      date_of_birth: "",
      belt_rank: "",
    },
  });

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, membersResponse] = await Promise.all([getClubs(), getMembers()]);
      setClubs(clubsResponse);
      setMembers(membersResponse);
      if (clubsResponse.length > 0 && !selectedClubId) {
        const firstClubId = clubsResponse[0].id;
        setSelectedClubId(firstClubId);
        setValue("club", String(firstClubId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!selectedClubId) {
      return members;
    }
    return members.filter((member) => member.club === selectedClubId);
  }, [members, selectedClubId]);

  const searchedMembers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return filteredMembers;
    }
    return filteredMembers.filter((member) => {
      const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
      return fullName.includes(normalizedQuery);
    });
  }, [filteredMembers, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(searchedMembers.length / pageSize));
  const pagedMembers = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return searchedMembers.slice(startIndex, startIndex + pageSize);
  }, [currentPage, searchedMembers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubId]);

  const onSubmit = async (values: MemberFormValues) => {
    setErrorMessage(null);
    const payload = {
      club: Number(values.club),
      first_name: values.first_name,
      last_name: values.last_name,
      date_of_birth: values.date_of_birth ? values.date_of_birth : null,
      belt_rank: values.belt_rank ?? "",
    };
    try {
      if (editingMember) {
        await updateMember(editingMember.id, payload);
      } else {
        await createMember(payload);
      }
      setEditingMember(null);
      setIsFormOpen(false);
      reset();
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save member.");
    }
  };

  const startEdit = (member: Member) => {
    setEditingMember(member);
    setIsFormOpen(true);
    reset({
      club: String(member.club),
      first_name: member.first_name,
      last_name: member.last_name,
      date_of_birth: member.date_of_birth ?? "",
      belt_rank: member.belt_rank ?? "",
    });
  };

  const startCreate = () => {
    setEditingMember(null);
    setIsFormOpen(true);
    reset({
      club: selectedClubId ? String(selectedClubId) : "",
      first_name: "",
      last_name: "",
      date_of_birth: "",
      belt_rank: "",
    });
  };

  return (
    <ClubAdminLayout title={t("membersTitle")} subtitle={t("membersSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full max-w-xs"
              placeholder={t("searchMembersPlaceholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Button onClick={startCreate}>{t("createMember")}</Button>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            {t("pageLabel", { current: currentPage, total: totalPages })}
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            >
              {t("previousPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : searchedMembers.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noMembersResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={[
              { key: "first_name", header: t("firstNameLabel") },
              { key: "last_name", header: t("lastNameLabel") },
              { key: "belt_rank", header: t("beltRankLabel") },
              { key: "date_of_birth", header: t("dobLabel") },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (member) => (
                  <Button variant="outline" size="sm" onClick={() => startEdit(member)}>
                    {t("editAction")}
                  </Button>
                ),
              },
            ]}
            rows={pagedMembers}
          />
        )}
      </div>

      <Modal
        title={editingMember ? t("updateMember") : t("createMember")}
        description={t("memberFormSubtitle")}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-zinc-700">{t("clubLabel")}</label>
            <Select
              value={watch("club")}
              onValueChange={(value) => {
                setSelectedClubId(Number(value));
                setValue("club", value, { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectClubPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((club) => (
                  <SelectItem key={club.id} value={String(club.id)}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.club ? <p className="text-sm text-red-600">{errors.club.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("firstNameLabel")}</label>
            <Input placeholder="Jane" {...register("first_name")} />
            {errors.first_name ? (
              <p className="text-sm text-red-600">{errors.first_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("lastNameLabel")}</label>
            <Input placeholder="Doe" {...register("last_name")} />
            {errors.last_name ? (
              <p className="text-sm text-red-600">{errors.last_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("dobLabel")}</label>
            <Input type="date" {...register("date_of_birth")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("beltRankLabel")}</label>
            <Input placeholder="1st Dan" {...register("belt_rank")} />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {editingMember ? t("updateMember") : t("createMember")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingMember(null);
                setIsFormOpen(false);
                reset();
              }}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </form>
      </Modal>
    </ClubAdminLayout>
  );
}

function getDefaultValues(): MemberFormValues {
  return {
    club: "",
    first_name: "",
    last_name: "",
    date_of_birth: "",
    belt_rank: "",
  };
}
