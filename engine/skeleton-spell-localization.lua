-- Offline only. The JS wrapper supplies a literal `configuration` table and
-- starts EMM exclusively against a disposable workspace copy, never the game.
assert(loader.features.export, "Localization proof requires export capability")
local mode = configuration.mode
assert(mode == "inspect" or mode == "read" or mode == "patch", "Invalid localization operation")
assert(mode ~= "patch" or loader.features.patch, "Patch capability is missing")
local function quote(s)
    return '"' .. string.gsub(s, '[%z\1-\31\\"]', function(c)
        local known = { ['"']='\\"', ['\\']='\\\\', ['\n']='\\n', ['\r']='\\r', ['\t']='\\t' }
        return known[c] or string.format('\\u%04x', string.byte(c))
    end) .. '"'
end
local function contentHash(h)
    return string.format('{"size":%d,"hash0":%d,"hash1":%d,"hash2":%d}', h.size, h.hash0, h.hash1, h.hash2)
end
local function reference(r)
    return '{"hash":' .. contentHash(r.hash) .. ',"category":{"value":' .. tostring(r.category.value)
        .. '},"bundleId":' .. tostring(r.bundleId) .. ',"sortKey":' .. tostring(r.sortKey) .. '}'
end
local resources = game.assets.get_resources_by_type("keen::LocaTagCollectionResource")
assert(#resources == 1, "Expected exactly one localization collection")
local resource = resources[1]
local collection = resource.data
local function exportCollection()
    local languages = {}
    for _, language in ipairs(collection.languages) do
        languages[#languages + 1] = '{"language":' .. quote(tostring(language.language)) .. ',"data":' .. reference(language.data) .. '}'
    end
    io.export('collection.json', '{"$type":"keen::LocaTagCollectionResource","$guid":' .. quote(resource.guid)
        .. ',"$part":' .. tostring(resource.part) .. ',"keenglishData":' .. reference(collection.keenglishData)
        .. ',"languages":[' .. table.concat(languages, ',') .. ']}')
end
local function dumpTags(data)
    local rows, seen = {}, {}
    for _, tag in ipairs(data.tags) do
        local id = tag.id.value
        assert(not seen[id], "Duplicate localization id in original payload")
        seen[id] = true
        local arguments = {}
        for _, argument in ipairs(tag.arguments) do
            arguments[#arguments + 1] = '{"id":' .. tostring(argument.id) .. ',"type":' .. quote(tostring(argument.type)) .. '}'
        end
        rows[#rows + 1] = '{"id":{"value":' .. tostring(id) .. '},"text":' .. quote(tag.text)
            .. ',"arguments":[' .. table.concat(arguments, ',') .. '],"genericArguments":' .. tostring(tag.genericArguments) .. '}'
    end
    return '{"tags":[' .. table.concat(rows, ',') .. ']}'
end
local references = { {key='fallback', reference=collection.keenglishData} }
for _, language in ipairs(collection.languages) do
    local name = tostring(language.language)
    if name == 'De_De' or name == 'En_Us' then references[#references + 1] = {key=name, reference=language.data} end
end
assert(#references == 3, "German or English localization payload is missing")
if mode ~= 'inspect' then
    for _, item in ipairs(references) do
        local input = game.assets.get_content(item.reference.hash):read_data()
        -- Verify the content-addressed bytes before trusting this source DAT.
        -- With correct bytes write_content finds the existing key and writes
        -- nothing. Any mismatch is contained in this disposable EMM copy.
        local originalHash = game.guid.from_content_hash(item.reference.hash)
        local checked = game.assets.create_content(input)
        assert(checked.guid == originalHash, 'Localization content hash does not match source bytes')
        local data = input:read_resource('keen::LocaTagCollectionResourceData')
        io.export(item.key .. '.json', dumpTags(data))
        if mode == 'patch' then
            local tags, seen = {}, {}
            for _, tag in ipairs(data.tags) do tags[#tags + 1] = tag; seen[tag.id.value] = true end
            for _, addition in ipairs(configuration.tags) do
                assert(not seen[addition.id], 'New localization id collides with an existing id')
                seen[addition.id] = true
                tags[#tags + 1] = {id={value=addition.id}, text=(item.key == 'De_De' and addition.de or addition.en), arguments={}, genericArguments=0}
            end
            -- The original payload is an ordered id lookup. Keep that invariant.
            table.sort(tags, function(a,b) return a.id.value < b.id.value end)
            local output = buffer.create()
            output:write_resource('keen::LocaTagCollectionResourceData', {tags=tags})
            local created = game.assets.create_content(output)
            item.reference.hash = {size=created.size,hash0=created.hash0,hash1=created.hash1,hash2=created.hash2}
        end
    end
end
customSummonIcon(configuration.icon, mode)
exportCollection()
