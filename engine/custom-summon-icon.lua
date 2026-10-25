-- Included by the localization mod, so new text and image bytes share one writer.
local function customSummonIcon(icon, mode)
    if not icon then return end
    assert(loader.features.export, 'Custom icon proof requires export capability')
    local function hashEqual(a,b)
        return a.size==b.size and a.hash0==b.hash0 and a.hash1==b.hash1 and a.hash2==b.hash2
    end
    local found=nil
    for _, resource in ipairs(game.assets.get_resources_by_type('keen::UiTextureResource')) do
        if tostring(resource.guid)==icon.itemGuid then
            assert(found==nil,'Duplicate own custom icon resource')
            found=resource
        end
    end
    assert(found,'Own sabertooth icon resource is missing')
    local d=found.data
    assert(hashEqual(d.data.hash,icon.hash),'Custom icon content reference differs')
    assert(d.size.x==icon.width and d.size.y==icon.height and tostring(d.format)==icon.format
        and d.levelCount==icon.levelCount and tostring(d.type)=='Texture2D' and not d.isTiled
        and d.debugName==icon.debugName,'Custom icon texture metadata differs')
    if mode=='patch' then
        assert(loader.features.patch,'Custom icon import requires patch capability')
        local bytes=io.read('src/sabertooth-spell.rgba')
        assert(bytes:tail()==icon.rawSize,'Custom icon raw size differs')
        local created=game.assets.create_content(bytes)
        assert(hashEqual(created,icon.hash),'Custom icon imported content hash differs')
    elseif mode=='read' and icon.required then
        local bytes=game.assets.get_content(icon.hash):read_data()
        assert(bytes:tail()==icon.rawSize,'Custom icon content size differs')
        local checked=game.assets.create_content(bytes)
        assert(hashEqual(checked,icon.hash),'Custom icon archive bytes differ')
        io.export('custom-icon.rgba',bytes)
    end
    io.export('custom-icon.json',string.format('{"guid":"%s","width":%d,"height":%d,"format":"%s","levelCount":%d,"debugName":"%s","hash":{"size":%d,"hash0":%d,"hash1":%d,"hash2":%d}}',icon.itemGuid,d.size.x,d.size.y,tostring(d.format),d.levelCount,d.debugName,d.data.hash.size,d.data.hash.hash0,d.data.hash.hash1,d.data.hash.hash2))
end
